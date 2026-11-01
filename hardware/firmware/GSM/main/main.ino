/*NewMC
 * OffStrap — OTP-Gated Pairing/Bonding (nRF52840 + Bluefruit)
 * + Track (RSSI) + Alarm (active buzzer on D5→GND) + Faster, robust FP (ZW0642)
 * + Device Information Service (BagID via Serial Number String)
 * + Owner-bound boot via persistent flag (InternalFS): shipping vs owner mode
 *
 * BSP: Adafruit nRF52 1.7.0 | Bluefruit 0.21.0 | USB Stack: TinyUSB
 */

#include <bluefruit.h>
#include <Adafruit_TinyUSB.h>
extern "C" {
  #include "nrf_sdm.h"
}

/* ================== Bag ID / DIS ================== */
#include <InternalFileSystem.h>
using namespace Adafruit_LittleFS_Namespace;

BLEDis bledis;

// Read nRF52840 64-bit unique ID and format as 16-char uppercase hex
static uint64_t nrf_uid64() {
  uint64_t hi = NRF_FICR->DEVICEID[1];
  uint64_t lo = NRF_FICR->DEVICEID[0];
  return (hi << 32) | lo;
}

static void uid64_to_hex(char out[17]) {
  uint64_t v = nrf_uid64();
  snprintf(out, 17, "%08lX%08lX",
           (unsigned long)((v >> 32) & 0xFFFFFFFFUL),
           (unsigned long)(v & 0xFFFFFFFFUL));
  out[16] = '\0';
}

static char g_bag_id_hex[17] = {0};

/* ================== USER TOGGLE ================== */
#define GSM_QUIET_BOOT 0   // 0 = skip GSM at boot (recommended).

/* ================== E-paper ================== */
#include <GxEPD2_BW.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include "FreeSansBold34pt7b.h"
#include "FreeSans12pt7b.h"
#include <QRCodeGFX.h>
#include <qrcode.h>

/* ================== Fingerprint UART (ZW0642) ================== */
// Wiring (Feather nRF52840):
// ZW0642 TXD -> D12 (MCU RX=12), ZW0642 RXD -> D11 (MCU TX=11), DET -> D13 (pin 13)
static const uint8_t FP_RX_PIN  = 12; // D12 (MCU RX)
static const uint8_t FP_TX_PIN  = 11; // D11 (MCU TX)
static const uint8_t FP_INT_PIN = 13; // D13 (Detect)
#define FP_SERIAL Serial1
static const uint32_t FP_BAUD = 57600;

/* ================== Fingerprint Power Gate (PMOS on D6) ================== */
// D6 drives PMOS gate: HIGH = OFF (default), LOW = ON (active)
static const int FP_PWR_PIN = 6;
static volatile uint8_t g_fp_power_ref = 0;

static inline void fp_power_on_hw() {
  digitalWrite(FP_PWR_PIN, LOW);    // pull gate low -> power ON
  delay(15);                        // rail settle (tune if needed)
}

static inline void fp_power_off_hw() {
  digitalWrite(FP_PWR_PIN, HIGH);   // gate high -> power OFF
  // no delay needed
}

// Reference-counted power session guards (safe for nested calls)
static inline void fp_session_begin(const char* tag) {
  if (g_fp_power_ref == 0) {
    fp_power_on_hw();
    Serial.print("[FP_PWR] ON  -> "); Serial.println(tag);
  }
  g_fp_power_ref++;
}

static inline void fp_session_end(const char* tag) {
  if (g_fp_power_ref > 0) {
    g_fp_power_ref--;
    if (g_fp_power_ref == 0) {
      fp_power_off_hw();
      Serial.print("[FP_PWR] OFF -> "); Serial.println(tag);
    }
  }
}


#define FP_DET_ACTIVE_HIGH 1
static const uint16_t DET_ACTIVE_STABLE_MS = 100;
static const uint8_t  DET_SAMPLES          = 8;

/* ================== Buzzer (ACTIVE type on D5 -> GND) ================== */
const int  BUZZER_PIN = 5;               // D5 -> BUZZER +
const bool BUZZER_ACTIVE_HIGH = true;    // HIGH = ON

static inline void buzzer_drive(bool on) {
  digitalWrite(BUZZER_PIN, (on ^ !BUZZER_ACTIVE_HIGH) ? HIGH : LOW);
}

// ---- Continuous "beep, beep" pair pattern ----
static bool     buzzerEnabled = false;
static uint32_t buzzerStartMs = 0;
static uint32_t buzzerMaxMs   = 30000;   // 30s safety cap

static uint32_t bzBeepMs      = 160;
static uint32_t bzGapShortMs  = 120;
static uint32_t bzGapLongMs   = 520;

static uint8_t  bzStage       = 0;
static uint32_t bzPhaseEndMs  = 0;

static void buzzer_start() {
  pinMode(BUZZER_PIN, OUTPUT);
  buzzer_drive(false);

  buzzerEnabled = true;
  buzzerStartMs = millis();

  bzStage      = 0;
  bzPhaseEndMs = millis() + bzBeepMs;

  publish_state("ALARM_ON");
}

static void buzzer_stop() {
  buzzerEnabled = false;
  buzzer_drive(false);

  bzStage      = 0;
  bzPhaseEndMs = 0;

  publish_state("ALARM_OFF");
}

static void buzzer_service() {
  if (!buzzerEnabled) return;

  if ((millis() - buzzerStartMs) >= buzzerMaxMs) {
    buzzer_stop();
    return;
  }

  bool on = (bzStage == 0 || bzStage == 2);
  buzzer_drive(on);

  uint32_t now = millis();
  while ((int32_t)(now - bzPhaseEndMs) >= 0) {
    switch (bzStage) {
      case 0: bzStage = 1; bzPhaseEndMs = now + bzGapShortMs; break;
      case 1: bzStage = 2; bzPhaseEndMs = now + bzBeepMs;     break;
      case 2: bzStage = 3; bzPhaseEndMs = now + bzGapLongMs;  break;
      default: bzStage = 0; bzPhaseEndMs = now + bzBeepMs;    break;
    }
    on = (bzStage == 0 || bzStage == 2);
    buzzer_drive(on);
    now = millis();
  }
}

/* ================== GSM pins (optional quiet) ================== */
static const int GSM_RX_PIN = 0;  // MCU RX <- A7670 TX
static const int GSM_TX_PIN = 1;  // MCU TX -> A7670 RX
static const uint32_t GSM_BAUD = 115200;

/* ================== ZW0642 protocol (subset) ================== */
const uint8_t  HEADER_HIGH     = 0xEF;
const uint8_t  HEADER_LOW      = 0x01;
const uint32_t DEVICE_ADDRESS  = 0xFFFFFFFF;

const uint8_t CMD_GET_IMAGE     = 0x01;
const uint8_t CMD_GEN_CHAR      = 0x02;
const uint8_t CMD_MATCH         = 0x03;
const uint8_t CMD_SEARCH        = 0x04;
const uint8_t CMD_REG_MODEL     = 0x05;
const uint8_t CMD_STORE_CHAR    = 0x06;
const uint8_t CMD_CLEAR_LIB     = 0x0D;
const uint8_t CMD_SET_SYSPARA   = 0x0E;
const uint8_t CMD_READ_SYSPARA  = 0x0F;
const uint8_t CMD_TEMPLATE_NUM  = 0x1D;
const uint8_t CMD_READ_INDEX    = 0x1F;
const uint8_t CMD_SLEEP         = 0x33;

static uint16_t g_capacity = 0;

/* ================== Orientation & EPD ================== */
static const uint8_t BASE_ROT     = 1;
static const bool    EPD_FLIP_180 = true;

GxEPD2_BW<GxEPD2_290_GDEY029T71H, GxEPD2_290_GDEY029T71H::HEIGHT> display(
  GxEPD2_290_GDEY029T71H(/*CS=*/19, /*DC=*/18, /*RST=*/17, /*BUSY=*/16)
);

static void epd_init_fast() {
  display.init(115200, true, 2, false);
  Serial.println("[EPD] Initialized");
}

static void centerText(const char* text, int y) {
  int16_t x1, y1; uint16_t w, h;
  display.getTextBounds(text, 0, y, &x1, &y1, &w, &h);
  int16_t x = (display.width() - w) / 2;
  display.setCursor(x, y);
  display.print(text);
}

static const char* SETUP_URL = "https://offstrap.com/setup";

static void drawSetupQRCode(const char* qrData) {
  uint8_t rot = (BASE_ROT + (EPD_FLIP_180 ? 2 : 0)) % 4;
  display.setRotation(rot);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_BLACK);
    display.setTextColor(GxEPD_WHITE);

    QRCodeGFX qrcode(display);
    qrcode.setForegroundColor(GxEPD_WHITE);
    qrcode.setBackgroundColor(GxEPD_BLACK);
    qrcode.generateData(qrData);

    int screenW = display.width();
    int screenH = display.height();
    int maxQrSize = screenW / 2;
    int qrPixelSize = qrcode.getSideLength();
    int scale = maxQrSize / qrPixelSize;
    if (scale < 1) scale = 1;
    qrcode.setScale(scale);

    int qrSize = qrcode.getSideLength();
    int qrX = 0;
    int qrY = (screenH - qrSize) / 2;
    qrcode.draw(qrX, qrY, true);

    int textX = screenW / 2 - 15;
    display.setFont(&FreeSansBold12pt7b);
    display.setCursor(textX, screenH / 2 - 10);
    display.print("Scan to setup");

    display.setFont(&FreeSansBold18pt7b);
    display.setCursor(textX, screenH / 2 + 30);
    display.print("OFFSTRAP");
  } while (display.nextPage());
}

static void printOTPScreen(const char* otp6, bool inverted) {
  uint8_t rot = (BASE_ROT + (EPD_FLIP_180 ? 2 : 0)) % 4;
  display.setRotation(rot);
  display.setFullWindow();
  display.firstPage();
  do {
    if (inverted) { display.fillScreen(GxEPD_BLACK); display.setTextColor(GxEPD_WHITE); }
    else          { display.fillScreen(GxEPD_WHITE); display.setTextColor(GxEPD_BLACK); }

    display.setFont(&FreeSansBold12pt7b);
    centerText("Use this OTP in the App", 30);

    const int boxWidth = 42, boxHeight = 58, spacing = 8;
    const int totalWidth = (6 * boxWidth) + (5 * spacing);
    const int startX = (display.width() - totalWidth) / 2;
    const int boxY = 60;

    display.setFont(&FreeSansBold12pt7b);
    for (int i = 0; i < 6; i++) {
      int x = startX + i * (boxWidth + spacing);
      display.drawRect(x, boxY, boxWidth, boxHeight, inverted ? GxEPD_WHITE : GxEPD_BLACK);
      char digit[2] = { otp6[i], '\0' };
      int16_t x1, y1; uint16_t w, h;
      display.getTextBounds(digit, 0, 0, &x1, &y1, &w, &h);
      int textX = x + (boxWidth - w) / 2;
      int textY = boxY + (boxHeight + h) / 2;
      display.setCursor(textX, textY);
      display.print(digit);
    }

    display.setFont(&FreeSansBold18pt7b);
    centerText("OFFSTRAP", display.height() - 10);
  } while (display.nextPage());
}

static void show_otp_on_epaper(uint32_t code) {
  char buf[7];
  snprintf(buf, sizeof(buf), "%06lu", (unsigned long)code);
  printOTPScreen(buf, true);
  Serial.print("[EPD] Shown OTP "); Serial.println(buf);
}

// =================== Lost Mode: render screen ===================
static void epd_centerText_(const char* text, int y) {
  int16_t x1, y1; uint16_t w, h;
  display.getTextBounds(text, 0, y, &x1, &y1, &w, &h);
  int16_t x = (display.width() - (int)w) / 2;
  display.setCursor(x, y);
  display.print(text);
}

static void epd_format_name_(char* dst, size_t dstLen, const char* src) {
  size_t len = strlen(src);
  if (len <= 16) {
    size_t i = 0;
    for (; src[i] && i + 1 < dstLen; ++i) {
      char c = src[i];
      if (c >= 'a' && c <= 'z') c -= 32;
      dst[i] = c;
    }
    dst[i] = '\0';
    return;
  }
  const char* sp = strchr(src, ' ');
  if (!sp) {
    size_t i = 0;
    for (; src[i] && i < 16 && i + 1 < dstLen; ++i) {
      char c = src[i];
      if (c >= 'a' && c <= 'z') c -= 32;
      dst[i] = c;
    }
    dst[i] = '\0';
    return;
  }
  size_t firstLen = (size_t)(sp - src);
  if (firstLen > dstLen - 4) firstLen = dstLen - 4;
  size_t i = 0;
  for (; i < firstLen && i + 1 < dstLen; ++i) {
    char c = src[i];
    if (c >= 'a' && c <= 'z') c -= 32;
    dst[i] = c;
  }
  if (i + 3 < dstLen) {
    dst[i++] = ' ';
    char li = *(sp + 1);
    if (li >= 'a' && li <= 'z') li -= 32;
    dst[i++] = li ? li : ' ';
    dst[i++] = '.';
  }
  dst[i] = '\0';
}

void epd_show_lost_mode(const char* name, const char* phone) {
  display.setRotation(3);
  display.setFullWindow();

  char nameLine[48];
  epd_format_name_(nameLine, sizeof(nameLine), name ? name : "");

  display.firstPage();
  do {
    display.fillScreen(GxEPD_BLACK);
    display.setTextColor(GxEPD_WHITE);

    display.setFont(&FreeSansBold12pt7b);
    epd_centerText_("LOST MODE ACTIVATED!", 24);

    display.setFont(&FreeSansBold12pt7b);
    epd_centerText_("This OFFSTRAP belongs to", 60);

    display.setFont(&FreeSansBold18pt7b);
    epd_centerText_(nameLine, 98);

    display.setFont(&FreeSansBold12pt7b);
    epd_centerText_("If found, Contact:", 123);

    display.setFont(&FreeSansBold18pt7b);
    epd_centerText_(phone ? phone : "", 156);

  } while (display.nextPage());
}


// ================== Brand Screen ==================
static const char MSG_BRAND[]   = "OFFSTRAP";
static const char MSG_TAGLINE[] = "Smart. Secure. Connected.";

static void printBrandScreen(bool inverted) {
  uint8_t rot = (BASE_ROT + (EPD_FLIP_180 ? 2 : 0)) % 4;
  display.setRotation(rot);
  display.setFullWindow();

  const int16_t H = display.height();   // 168
  const int16_t bottomPadding = 12;
  const int16_t brandTargetY  = H / 2;

  display.firstPage();
  do {
    if (inverted) { display.fillScreen(GxEPD_BLACK); display.setTextColor(GxEPD_WHITE); }
    else          { display.fillScreen(GxEPD_WHITE); display.setTextColor(GxEPD_BLACK); }

    display.setFont(&FreeSansBold34pt7b);
    centerText(MSG_BRAND, brandTargetY);

    display.setFont(&FreeSans12pt7b);
    int16_t x1, y1; uint16_t tw, th;
    display.getTextBounds(MSG_TAGLINE, 0, 0, &x1, &y1, &tw, &th);
    int16_t taglineY = H - bottomPadding;
    centerText(MSG_TAGLINE, taglineY);

  } while (display.nextPage());

  Serial.println("[EPD] Brand screen shown");
}

// ---- Smart Display helpers (fixed font: FreeSansBold 18pt) ----
static void epd_show_blank_black() {
  uint8_t rot = (BASE_ROT + (EPD_FLIP_180 ? 2 : 0)) % 4;
  display.setRotation(rot);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_BLACK);
    display.setTextColor(GxEPD_WHITE); // keep white theme
  } while (display.nextPage());
  Serial.println("[EPD] Blank black shown");
}

static void _measure_line_18(const char* s, int16_t baselineY, uint16_t &w, uint16_t &h, int16_t &yTop) {
  int16_t x1, y1; display.getTextBounds(s, 0, baselineY, &x1, &y1, &w, &h);
  yTop = y1; // top of glyph box relative to baseline
}

static bool _fits_width_18(const String& s, int16_t maxW) {
  uint16_t w,h; int16_t yTop;
  _measure_line_18(s.c_str(), 0, w, h, yTop);
  return (int16_t)w <= maxW;
}

// word-wrap (18pt): fills up to maxLines in linesOut, returns line count
static int _wrap_text_18(const char* s, int16_t maxLineWidth, String* linesOut, int maxLines) {
  String text = String(s);
  text.replace("\n", " ");
  while (text.indexOf("  ") >= 0) text.replace("  ", " ");
  text.trim();

  if (text.length() == 0) { linesOut[0] = ""; return 1; }

  int lineCount = 0;
  String current = "";
  int i = 0, n = text.length();

  auto pushLine = [&](const String& L) {
    if (lineCount < maxLines) linesOut[lineCount++] = L;
  };

  while (i < n) {
    // next word
    int j = i;
    while (j < n && text[j] != ' ') j++;
    String word = text.substring(i, j);

    // spaces after word
    int k = j;
    while (k < n && text[k] == ' ') k++;

    if (current.length() == 0) {
      if (_fits_width_18(word, maxLineWidth)) {
        current = word;
      } else {
        // break an overlong token by characters
        int lo = 0, hi = word.length(), best = 0;
        while (lo <= hi) {
          int mid = (lo + hi) / 2;
          String part = word.substring(0, mid);
          if (_fits_width_18(part, maxLineWidth)) { best = mid; lo = mid + 1; }
          else { hi = mid - 1; }
        }
        if (best == 0) best = 1;
        pushLine(word.substring(0, best));
        String rest = word.substring(best);
        if (rest.length()) {
          text = rest + " " + text.substring(k);
          n = text.length();
          i = 0;
          k = 0;
          current = "";
          continue;
        }
      }
    } else {
      String trial = current + " " + word;
      if (_fits_width_18(trial, maxLineWidth)) {
        current = trial;
      } else {
        pushLine(current);
        current = "";
        continue; // retry 'word' on next loop at new line
      }
    }
    i = k; // advance
  }

  if (current.length()) pushLine(current);
  return lineCount > 0 ? lineCount : 1;
}

// Render personalised text: centered, white on black, FreeSansBold 18pt (wrapped)
static void epd_show_centered_text_white_on_black_18(const char* s) {
  if (!s) s = "";

  // Prepare display
  uint8_t rot = (BASE_ROT + (EPD_FLIP_180 ? 2 : 0)) % 4;
  display.setRotation(rot);
  display.setFullWindow();

  // Fixed font
  display.setFont(&FreeSansBold18pt7b);

  const int MAX_LINES = 7;
  String lines[MAX_LINES];

  const int16_t screenW = (int16_t)display.width();
  const int16_t screenH = (int16_t)display.height();

  const int16_t sidePad = 10;
  const int16_t maxLineW = screenW - 2 * sidePad;

  // wrap text
  int lineCount = _wrap_text_18(s, maxLineW, lines, MAX_LINES);

  // measure each line for centering
  uint16_t lineW[MAX_LINES], lineH[MAX_LINES];
  int16_t  lineYTop[MAX_LINES];
  for (int i = 0; i < lineCount; i++) {
    _measure_line_18(lines[i].c_str(), 0, lineW[i], lineH[i], lineYTop[i]);
  }

  const int16_t lineGap = 2;
  int16_t totalH = 0;
  for (int i = 0; i < lineCount; i++) totalH += lineH[i];
  totalH += (lineCount - 1) * lineGap;

  // if too tall, trim & ellipsize the last visible line
  while (totalH > screenH && lineCount > 1) {
    lineCount--;
    totalH = 0;
    for (int i = 0; i < lineCount; i++) totalH += lineH[i];
    totalH += (lineCount - 1) * lineGap;
  }
  if (totalH > screenH) {
    String base = lines[0];
    while (base.length() > 1) {
      base.remove(base.length() - 1);
      String trial = base + "…";
      if (_fits_width_18(trial, maxLineW)) { lines[0] = trial; break; }
    }
    _measure_line_18(lines[0].c_str(), 0, lineW[0], lineH[0], lineYTop[0]);
    totalH = lineH[0];
    lineCount = 1;
  }

  const int16_t blockTop = (screenH - totalH) / 2;

  display.firstPage();
  do {
    display.fillScreen(GxEPD_BLACK);
    display.setTextColor(GxEPD_WHITE);

    int16_t yCursorTop = blockTop;
    for (int i = 0; i < lineCount; i++) {
      // baseline so glyph-top aligns at yCursorTop
      int16_t baselineY = yCursorTop - lineYTop[i];
      int16_t x = (screenW - (int16_t)lineW[i]) / 2;

      display.setCursor(x, baselineY);
      display.print(lines[i]);

      yCursorTop += (int16_t)lineH[i] + lineGap;
    }
  } while (display.nextPage());

  Serial.println("[EPD] Wrapped centered text (18pt) shown");
}

/* -------- Smart Display mode tracking + renderer ---------- */
enum DisplayMode : uint8_t { DISP_LOGO, DISP_BLANK, DISP_TEXT, DISP_IMAGE };
static DisplayMode g_disp_mode = DISP_LOGO;              // current mode
static DisplayMode g_prev_mode_before_lost = DISP_LOGO;  // snapshot when LOST_ON
static bool g_prev_mode_valid = false;                   // snapshot valid?
static char g_display_text[64] = {0}; // UI caps at 50; buffer leaves room

static void render_current_display_mode() {
  switch (g_disp_mode) {
    case DISP_LOGO:
      printBrandScreen(true);
      break;
    case DISP_BLANK:
      epd_show_blank_black();
      break;
    case DISP_TEXT:
      if (g_display_text[0]) {
        epd_show_centered_text_white_on_black_18(g_display_text);
      } else {
        printBrandScreen(true);
      }
      break;
    case DISP_IMAGE:
      // reserved – show logo for now
      printBrandScreen(true);
      break;
  }
}

/* ================== BLE config ================== */
static const char* NAME_OTP    = "OffStrap-OTP";
static const char* NAME_SECURE = "OffStrap";

static const uint32_t OTP_WINDOW_MS = 180000;

BLEService       otpService   ("8b7a0001-bf5f-4a9a-9955-2a6f8a7f6c01");
BLECharacteristic otpChar     ("8b7a0002-bf5f-4a9a-9955-2a6f8a7f6c01"); // write / writeNR
BLECharacteristic stateChar   ("8b7a0003-bf5f-4a9a-9955-2a6f8a7f6c01"); // read + notify (status)

BLEService       secureService("8b7a1001-bf5f-4a9a-9955-2a6f8a7f6c01");
BLECharacteristic secureData  ("8b7a1002-bf5f-4a9a-9955-2a6f8a7f6c01"); // encrypted RX/TX

volatile bool     g_authorized    = false;
volatile bool     g_need_otp      = false;
volatile uint16_t g_conn_handle   = BLE_CONN_HANDLE_INVALID;
volatile bool     g_in_otp_mode   = true;

uint32_t g_expected_otp = 0;
uint32_t g_otp_deadline = 0;

static const uint32_t WAKE_WINDOW_MS = 180000;
volatile bool     g_awake        = false;
uint32_t          g_wake_started = 0;
bool              g_ble_inited   = false;

// Cached owner mode so we can branch logic at runtime
static bool g_owner_mode = false;

// ===== Lost Mode (RAM only) =====
static bool g_lost_mode_active = false;
static char g_lost_name[64]  = {0};
static char g_lost_phone[32] = {0};

/* ====== Owner-mode security helpers (bond + stranger eject) ====== */
static const uint32_t ENCRYPT_GRACE_MS = 10000; // 10s to become encrypted
static uint32_t g_conn_time_ms = 0;

/* ====== Advertising fast→slow window management ====== */
static bool     g_adv_fast_active = false;
static uint32_t g_adv_fast_start  = 0;
static const uint32_t ADV_FAST_WINDOW_MS = 90000; // 90 seconds
// Background reconnect "pulse" while in SLOW advertising
static uint32_t g_adv_pulse_until = 0;
static uint32_t g_adv_last_pulse  = 0;
static const uint32_t ADV_PULSE_LEN_MS    = 4000;   // 4s FAST burst
static const uint32_t ADV_PULSE_PERIOD_MS = 30000;  // every 30s

/* ================== Owner flag (InternalFS) ================== */
static const char* OWNER_FLAG_PATH = "/owner.flag";

static void fs_init_once() {
  static bool inited = false;
  if (inited) return;
  InternalFS.begin();
  inited = true;
}

static bool owner_flag_get() {
  fs_init_once();
  File f(InternalFS);
  if (!f.open(OWNER_FLAG_PATH, FILE_O_READ)) return false;
  f.close();
  return true;
}

static void owner_flag_set(bool on) {
  fs_init_once();
  if (on) {
    File f(InternalFS);
    if (f.open(OWNER_FLAG_PATH, FILE_O_WRITE)) {
      const char* marker = "OWNED\n";
      (void)f.write((const uint8_t*)marker, strlen(marker));
      f.close();
    }
  } else {
    InternalFS.remove(OWNER_FLAG_PATH);
  }
  g_owner_mode = on;
}

/* ================== Helpers ================== */
static void publish_state(const char* s) {
  stateChar.write((const uint8_t*)s, strlen(s));
  stateChar.notify((const uint8_t*)s, strlen(s));
  Serial.print("[STATE] "); Serial.println(s);
}

static void secure_send_text(const char* s) {
  secureData.notify((const uint8_t*)s, strlen(s));
  Serial.print("[TX] "); Serial.println(s);
}

/* ====== ADV interval helpers ====== */
static void set_adv_profile_fast() {
  // 100–125 ms
  Bluefruit.Advertising.setInterval(160 /*100ms*/, 200 /*125ms*/);
  g_adv_fast_active = true;
  g_adv_fast_start  = millis();
  Serial.println("[BLE] ADV profile: FAST");
}
static void set_adv_profile_slow() {
  // 1000 ms
  Bluefruit.Advertising.setInterval(1600 /*1000ms*/, 1600 /*1000ms*/);
  g_adv_fast_active = false;
  Serial.println("[BLE] ADV profile: SLOW");
}

static void startAdvertising(bool otpMode) {
  Bluefruit.Advertising.stop();
  Bluefruit.Advertising.clearData();
  Bluefruit.ScanResponse.clearData();

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();

  if (otpMode) {
    Bluefruit.setName(NAME_OTP);
    Bluefruit.Advertising.addService(otpService);   // ✅ Service UUID in ADV (critical for iOS background wake)
    Serial.println("[BLE] Advertising OffStrap-OTP (OTP service)");
  } else {
    Bluefruit.setName(NAME_SECURE);
    Bluefruit.Advertising.addService(secureService);
    Serial.println("[BLE] Advertising OffStrap (SECURE service)");
  }

  Bluefruit.ScanResponse.addName();

  // Always restart on disconnect, we manage fast->slow ourselves
  Bluefruit.Advertising.restartOnDisconnect(true);

  // Begin in FAST profile for 90s, then we’ll switch to SLOW in loop()
  set_adv_profile_fast();
  Bluefruit.Advertising.start(0); // forever
  Serial.println("[BLE] Advertising started");
  g_adv_pulse_until = 0;
  g_adv_last_pulse  = millis();
}

/* ================== Deferred action flags (set in callback, handled in loop) ================== */
volatile bool g_req_alarm_on  = false;
volatile bool g_req_alarm_off = false;

volatile bool g_req_mode_logo  = false;
volatile bool g_req_mode_blank = false;
volatile bool g_req_mode_text  = false;
volatile bool g_req_mode_image = false; // reserved

volatile bool g_req_lost_on      = false;
volatile bool g_req_lost_off     = false;
volatile bool g_req_lost_render  = false; // when name/phone ready -> render

static char g_pending_display_text[64] = {0}; // written in cb, read in loop

/* ================== BLE callbacks ================== */
void connect_callback(uint16_t conn_handle) {
  g_conn_handle = conn_handle; 
  g_authorized  = false;
  g_conn_time_ms = millis();

  // On connect, advertising stops; mark state
  g_adv_fast_active = false;

  Serial.print("[BLE] Connected, handle="); Serial.println(conn_handle);

  if (g_in_otp_mode) {
    g_need_otp = true; // shipping path
    return;
  }

  // OWNER mode: bonded reconnects should encrypt quickly
  BLEConnection* c = Bluefruit.Connection(g_conn_handle);
  if (c) {
    c->requestPairing(); // bonded peers will auto-secure silently
    publish_state("Awaiting secure link");
  }
}

void disconnect_callback(uint16_t /*conn_handle*/, uint8_t reason) {
  g_conn_handle = BLE_CONN_HANDLE_INVALID;
  g_authorized = false; g_need_otp = false;
  Serial.print("[BLE] Disconnected, reason=0x"); Serial.println(reason, HEX);

  // Ensure we resume FAST advertising window immediately on every drop
  Bluefruit.Advertising.stop();
  set_adv_profile_fast();
  Bluefruit.Advertising.start(0);
  g_adv_pulse_until = 0;
  g_adv_last_pulse  = millis();
}

/* ================== OTP write ================== */
void otp_write_cb(uint16_t conn_handle, BLECharacteristic*, uint8_t* data, uint16_t len) {
  if (conn_handle != g_conn_handle || !g_in_otp_mode) return;
  if (len != 6) { publish_state("Invalid length"); return; }

  char in[7] = {0}; memcpy(in, data, 6);
  uint32_t entered = (uint32_t)strtoul(in, nullptr, 10);
  Serial.print("[OTP] Entered = "); Serial.println(entered);

  if (millis() > g_otp_deadline) { publish_state("OTP timeout"); return; }

  if (entered == g_expected_otp) {
    g_authorized = true; publish_state("Authorized");
    BLEConnection* c = Bluefruit.Connection(g_conn_handle);
    if (c) { publish_state("Awaiting secure link"); c->requestPairing(); }
    else   { Serial.println("[WARN] No connection object to pair."); }
  } else {
    publish_state("Wrong OTP"); Serial.println("[OTP] Mismatch.");
  }
}

/* ================== RNG/OTP ================== */
static uint32_t sd_rand_u32() {
  uint8_t buf[4], have = 0;
  while (have < 4) {
    uint8_t avail = 0;
    sd_rand_application_bytes_available_get(&avail);
    if (!avail) { delay(1); continue; }
    uint8_t want = min<uint8_t>(4 - have, avail);
    sd_rand_application_vector_get(buf + have, want);
    have += want;
  }
  uint32_t v; memcpy(&v, buf, 4); return v;
}
static uint32_t generate_6digit_otp() { return (sd_rand_u32() % 900000UL) + 100000UL; }

/* ================== FP helpers, parsing, enrollment ================== */
static void clearFpRx() { while (FP_SERIAL.available()) (void)FP_SERIAL.read(); }
static void send_common_prefix(uint8_t* p) {
  p[0]=HEADER_HIGH; p[1]=HEADER_LOW;
  p[2]=(DEVICE_ADDRESS>>24)&0xFF; p[3]=(DEVICE_ADDRESS>>16)&0xFF;
  p[4]=(DEVICE_ADDRESS>>8)&0xFF;  p[5]=(DEVICE_ADDRESS)&0xFF;
  p[6]=0x01; // command packet
}
static void send_cmd(uint8_t cmd) {
  uint16_t length = 3, checksum = 1 + length + cmd;
  uint8_t pkt[12]; send_common_prefix(pkt);
  pkt[7]=(length>>8)&0xFF; pkt[8]=length&0xFF;
  pkt[9]=cmd; pkt[10]=(checksum>>8)&0xFF; pkt[11]=checksum&0xFF;
  FP_SERIAL.write(pkt, sizeof(pkt));
}
static void send_cmd2(uint8_t cmd, uint8_t p1) {
  uint16_t length = 4, checksum = 1 + length + cmd + p1;
  uint8_t pkt[13]; send_common_prefix(pkt);
  pkt[7]=(length>>8)&0xFF; pkt[8]=length&0xFF;
  pkt[9]=cmd; pkt[10]=p1; pkt[11]=(checksum>>8)&0xFF; pkt[12]=checksum&0xFF;
  FP_SERIAL.write(pkt, sizeof(pkt));
}
static void send_cmd3(uint8_t cmd, uint8_t p1, uint16_t p2) {
  uint16_t length = 6, checksum = 1 + length + cmd + p1 + (p2>>8) + (p2&0xFF);
  uint8_t pkt[15]; send_common_prefix(pkt);
  pkt[7]=(length>>8)&0xFF; pkt[8]=length&0xFF;
  pkt[9]=cmd; pkt[10]=p1; pkt[11]=(p2>>8)&0xFF; pkt[12]=p2&0xFF;
  pkt[13]=(checksum>>8)&0xFF; pkt[14]=checksum&0xFF;
  FP_SERIAL.write(pkt, sizeof(pkt));
}
static void send_cmd4(uint8_t cmd, uint8_t p1, uint16_t p2, uint16_t p3) {
  uint16_t length = 8, checksum = 1 + length + cmd + p1 + (p2>>8) + (p2&0xFF) + (p3>>8) + (p3&0xFF);
  uint8_t pkt[17]; send_common_prefix(pkt);
  pkt[7]=(length>>8)&0xFF; pkt[8]=length&0xFF;
  pkt[9]=cmd; pkt[10]=p1; pkt[11]=(p2>>8)&0xFF; pkt[12]=p2&0xFF;
  pkt[13]=(p3>>8)&0xFF; pkt[14]=p3&0xFF; pkt[15]=(checksum>>8)&0xFF; pkt[16]=checksum&0xFF;
  FP_SERIAL.write(pkt, sizeof(pkt));
}
static uint8_t receiveCode(uint32_t timeout_ms) {
  uint8_t buf[96]; uint16_t n = 0;
  uint32_t start = millis();
  while (millis() - start < timeout_ms && n < sizeof(buf)) {
    while (FP_SERIAL.available() && n < sizeof(buf)) {
      buf[n++] = FP_SERIAL.read();
    }
  }
  if (n < 12) return 0xFD;
  for (uint16_t i = 0; i + 12 <= n; i++) {
    if (buf[i] == 0xEF && buf[i+1] == 0x01 && buf[i+6] == 0x07) {
      return buf[i+9];
    }
  }
  return 0xFE;
}
static bool receiveOK(uint32_t timeout_ms) { return receiveCode(timeout_ms) == 0x00; }
static int readTemplateCount() {
  clearFpRx(); send_cmd(CMD_TEMPLATE_NUM);
  uint8_t resp[64]={0}; uint8_t idx=0; uint32_t start=millis();
  while (millis()-start<1000 && idx<sizeof(resp)) { if (FP_SERIAL.available()) resp[idx++]=FP_SERIAL.read(); }
  if (idx>=12 && resp[0]==0xEF && resp[1]==0x01 && resp[6]==0x07 && resp[9]==0x00) {
    return (int)(((uint16_t)resp[10] << 8) | resp[11]);
  }
  return -1;
}
static bool readIndexPage(uint8_t page, uint8_t out32[32]) {
  clearFpRx(); send_cmd2(CMD_READ_INDEX, page);
  uint8_t resp[128]={0}; uint8_t idx=0; uint32_t start=millis();
  while (millis()-start<1000 && idx<sizeof(resp)) { if (FP_SERIAL.available()) resp[idx++]=FP_SERIAL.read(); }
  if (idx>=44 && resp[0]==0xEF && resp[1]==0x01 && resp[6]==0x07 && resp[9]==0x00) {
    for (uint8_t i=0;i<32;i++) out32[i] = resp[10+i]; return true;
  }
  return false;
}
static int findNextFreeID() {
  if (g_capacity == 0) g_capacity = 1000;
  uint16_t remaining = g_capacity; uint8_t page=0;
  while (remaining > 0) {
    uint8_t bits[32];
    if (!readIndexPage(page, bits)) {
      for (uint16_t i=page*256; i<page*256+256 && i<g_capacity; i++) { if (i==0) continue; return i; }
      return -1;
    }
    for (uint16_t bit=0; bit<256 && (page*256+bit)<g_capacity; bit++) {
      uint16_t id = (uint16_t)(page*256 + bit);
      if (id==0) continue;
      uint8_t byteIdx = bit/8; uint8_t mask = 1 << (bit%8);
      bool used = (bits[byteIdx] & mask) != 0;
      if (!used) return (int)id;
    }
    remaining = (remaining>256)?(remaining-256):0; page++;
  }
  return -1;
}
inline bool detIsActive() {
  #if FP_DET_ACTIVE_HIGH
    return digitalRead(FP_INT_PIN) == HIGH;
  #else
    return digitalRead(FP_INT_PIN) == LOW;
  #endif
}
static bool detActiveStable() {
  uint32_t start = millis(); uint8_t ok = 0;
  while (millis() - start < DET_ACTIVE_STABLE_MS) { if (detIsActive()) ok++; delay(DET_ACTIVE_STABLE_MS / DET_SAMPLES); }
  return ok >= (DET_SAMPLES * 3 / 4);
}
static void enter_idle_wait_for_finger() { Serial.println("[FP] Waiting for finger..."); while (!detActiveStable()) { delay(10); } }
static bool waitForFinger(uint32_t timeout_ms) {
  uint32_t start = millis();
  while (true) {
    if (detIsActive()) break;
    if (millis() - start > timeout_ms) { Serial.println(" [TIMEOUT] No finger detected."); return false; }
    delay(5);
  }
  Serial.println(" [OK] Finger detected. KEEP your finger steady...");
  return true;
}
static bool waitForFingerGone(uint32_t timeout_ms) {
  uint32_t start = millis();
  while (true) {
    if (!detIsActive()) break;
    if (millis() - start > timeout_ms) { Serial.println(" [TIMEOUT] Finger not removed."); return false; }
    delay(5);
  }
  return true;
}
static bool captureToCharBuffer(uint8_t bufId, uint8_t maxAttempts = 5) {
  for (uint8_t tries = 0; tries < maxAttempts; tries++) {
    clearFpRx();
    send_cmd(CMD_GET_IMAGE);
    if (!receiveOK(400)) { delay(200); continue; }

    clearFpRx();
    send_cmd2(CMD_GEN_CHAR, bufId);
    if (receiveOK(400)) return true;

    delay(200);
  }
  return false;
}
static bool captureMergeStoreOneTouch(uint16_t id) {
  if (!waitForFinger(15000)) { 
    return false; 
  }

  if (!captureToCharBuffer(1, 5)) { 
    return false; 
  }
  delay(250);

  if (!detIsActive()) {
    Serial.println(" [HINT] Keep your finger steady...");
    if (!waitForFinger(3000)) { 
      return false; 
    }
  }

  if (!captureToCharBuffer(2, 5)) { 
    return false; 
  }

  publish_state("REMOVE_FINGER");
  (void)waitForFingerGone(6000);

  clearFpRx(); 
  send_cmd(CMD_REG_MODEL);
  if (!receiveOK(600)) { 
    Serial.println(" [ERR] REG_MODEL"); 
    return false; 
  }

  clearFpRx(); 
  send_cmd3(CMD_STORE_CHAR, 1, id);
  if (!receiveOK(600)) { 
    Serial.println(" [ERR] STORE_CHAR"); 
    return false; 
  }

  return true;
}


static bool fp_verify_once() {
  fp_session_begin("verify_once");
  publish_state("VERIFY_PLACE");
  if (!waitForFinger(12000)) { publish_state("VERIFY_NO_MATCH"); fp_session_end("verify_once"); return false; }
  if (!captureToCharBuffer(1, 5)) {
    publish_state("VERIFY_REMOVE");
    (void)waitForFingerGone(3000);
    publish_state("VERIFY_NO_MATCH");
    fp_session_end("verify_once");
    return false;
  }
  publish_state("VERIFY_REMOVE");
  (void)waitForFingerGone(4000);

  clearFpRx();
  send_cmd4(CMD_SEARCH, 1, 0, 1000);
  bool match = (receiveCode(800) == 0x00);
  publish_state(match ? "VERIFY_MATCH" : "VERIFY_NO_MATCH");
  fp_session_end("verify_once");
  return match;
}

static bool fp_clear_database_once(uint32_t timeout_ms = 2000) {
  fp_session_begin("db_clear_once");
  clearFpRx();
  send_cmd(CMD_CLEAR_LIB);
  bool ok = receiveOK(timeout_ms);
  if (!ok) {
    Serial.println("[FP] CLEAR_LIB NACK/timeout");
    publish_state("DB_CLEAR_FAILED");
    fp_session_end("db_clear_once");
    return false;
  }
  delay(50);
  int count = readTemplateCount();
  Serial.print("[FP] Templates after CLEAR_LIB = "); Serial.println(count);
  if (count > 0) {
    publish_state("DB_CLEAR_RETRY");
    fp_session_end("db_clear_once");
    return false;
  }
  publish_state("DB_CLEARED");
  fp_session_end("db_clear_once");
  return true;
}

static bool fp_clear_database_strict(uint8_t max_retries = 3) {
  for (uint8_t i = 0; i < max_retries; i++) {
    if (fp_clear_database_once(2500)) return true;
    delay(120);
  }
  return false;
}
volatile bool g_enroll_requested = false;
volatile bool g_verify_pending  = false;
uint8_t      g_verify_attempts  = 0;
volatile bool g_enroll_active   = false;
static bool run_enrollment_5_strict() {
  const int STEPS = 5;
  Serial.println("[ENROLL] Starting one-touch enrollment: need 5 successful impressions");
  g_enroll_active = true;
  fp_session_begin("enroll_full");


  int step = 1;
  while (step <= STEPS) {
    publish_state("PLACE_FINGER");
    int id = findNextFreeID();
    if (id < 1) { Serial.println(" [ERR] No free ID"); return false; }

    bool success = captureMergeStoreOneTouch((uint16_t)id);
    if (success) {
      char stepMsg[24];
      snprintf(stepMsg, sizeof(stepMsg), "ENROLL_STEP %d/%d", step, STEPS);
      publish_state(stepMsg);
      Serial.print("[ENROLL] Stored ID "); Serial.println(id);
      step++;
    } else {
      publish_state("ENROLL_RETRY_SAME_STEP");
      Serial.println("[ENROLL] Step failed -> retrying same step");
    }
  }

  publish_state("ENROLL_DONE");
  Serial.println("[ENROLL] Done. Running quick verify...");
  bool ok = fp_verify_once();
  g_enroll_active = false;
  fp_session_end("enroll_full");
  if (!ok) {
    Serial.println("[ENROLL] Verify failed (post-enroll).");
  }
  else
  {
    printBrandScreen(true);
  }
  return ok;
}

/* ================== SECURE commands ================== */
static float rssi_to_meters(int8_t rssi) {
  const float txPower = -59.0f;
  const float n       = 2.2f;
  float meters = powf(10.0f, (txPower - (float)rssi) / (10.0f * n));
  if (meters < 0.1f) meters = 0.1f;
  if (meters > 50.0f) meters = 50.0f;
  return meters;
}
static bool get_connected_rssi(int8_t &out) {
  BLEConnection* c = Bluefruit.Connection(g_conn_handle);
  if (!c) return false;
  int8_t r = c->getRssi();
  if (r == 127) return false;
  out = r; return true;
}
static void reply_track_now() {
  int8_t rssi;
  if (!get_connected_rssi(rssi)) {
    secure_send_text("TRACK_DIST -1 RSSI=127");
    return;
  }
  float meters = rssi_to_meters(rssi);
  char msg[48];
  snprintf(msg, sizeof(msg), "TRACK_DIST %.2f RSSI=%d", meters, (int)rssi);
  secure_send_text(msg);
}
static void print_hex(const uint8_t* d, uint16_t n) {
  for (uint16_t i = 0; i < n; i++) { if (d[i] < 16) Serial.print('0'); Serial.print(d[i], HEX); if (i+1!=n) Serial.print(' '); }
}

void secure_write_cb(uint16_t conn_handle, BLECharacteristic*, uint8_t* data, uint16_t len) {
  if (conn_handle != g_conn_handle) return;
  if (!g_authorized) {
    Serial.println("[SECURE CMD] Ignored (not authorized yet)");
    return;
  }

  // DEBUG (non-blocking): print what we received
  Serial.print("[SECURE CMD] len="); Serial.print(len); Serial.print(" ASCII=\"");
  for (uint16_t i = 0; i < len; i++) {
    char c = (char)data[i];
    if (c >= 32 && c <= 126) Serial.print(c); else Serial.print('.');
  }
  Serial.print("\" HEX="); print_hex(data, len); Serial.println();

  auto equals = [&](const char* s)->bool {
    return (len == strlen(s) && memcmp(data, s, len) == 0);
  };
  auto startsWith = [&](const char* prefix)->bool {
    size_t n = strlen(prefix);
    return (len >= n && memcmp(data, prefix, n) == 0);
  };

  // ===== LOST MODE (3-command protocol) - defer heavy work =====
  if (equals("LOST_ON")) {
    g_prev_mode_before_lost = g_disp_mode;  // snapshot current screen
    g_prev_mode_valid = true;

    g_lost_mode_active = true;
    g_lost_name[0]  = 0;
    g_lost_phone[0] = 0;

    g_req_lost_on = true;         // mark state change
    publish_state("LOST_ON_ACK");
    return;
  }
  if (startsWith("LOST_NAME|")) {
    const uint16_t kPrefix = 10;
    size_t copyLen = (len > kPrefix) ? (len - kPrefix) : 0;
    if (copyLen >= sizeof(g_lost_name)) copyLen = sizeof(g_lost_name) - 1;
    if (copyLen > 0) {
      memcpy(g_lost_name, data + kPrefix, copyLen);
      g_lost_name[copyLen] = 0;
    } else {
      g_lost_name[0] = 0;
    }
    publish_state("LOST_NAME_ACK");
    return;
  }
  if (startsWith("LOST_PHONE|")) {
    const uint16_t kPrefix = 11;
    size_t copyLen = (len > kPrefix) ? (len - kPrefix) : 0;
    if (copyLen >= sizeof(g_lost_phone)) copyLen = sizeof(g_lost_phone) - 1;
    if (copyLen > 0) {
      memcpy(g_lost_phone, data + kPrefix, copyLen);
      g_lost_phone[copyLen] = 0;
    } else {
      g_lost_phone[0] = 0;
    }
    publish_state("LOST_PHONE_ACK");

    if (g_lost_mode_active) {
      g_req_lost_render = true;   // render in loop()
    }
    return;
  }
  if (equals("LOST_OFF")) {
    g_lost_mode_active = false;
    g_req_lost_off = true;        // restore previous screen in loop()
    publish_state("LOST_OFF_ACK");
    return;
  }

  // ===== FP / Other commands (defer heavy work) =====
  if (equals("FP_ENROLL_START")) {
    publish_state("Enroll start requested");
    g_enroll_requested = true;
    g_enroll_active    = true;
    g_verify_pending   = false;
    g_verify_attempts  = 0;
    return;
  }
  if (equals("FP_VERIFY_RETRY")) {
    bool ok = fp_verify_once();   // small + bounded, ok inline
    if (ok) publish_state("ENROLL_VERIFY_DONE");
    return;
  }
  if (equals("FP_DB_CLEAR")) {
    Serial.println("[CMD] FP_DB_CLEAR received");
    g_enroll_requested = false;
    g_enroll_active    = false;

    bool ok = fp_clear_database_strict();
    if (!ok) {
      publish_state("DB_CLEAR_FAILED");
    } else {
      int next = findNextFreeID();
      char msg[32];
      snprintf(msg, sizeof(msg), "DB_EMPTY_NEXT_ID %d", (next < 0 ? -1 : next));
      publish_state(msg);
    }
    return;
  }
  if (equals("FP_START_OVER")) {
    (void)fp_clear_database_strict();

    owner_flag_set(false);
    Serial.println("[OWNER] Flag cleared (factory reset).");

    Bluefruit.Advertising.stop();
    g_awake = false; g_need_otp = false; g_authorized = false;
    g_expected_otp = 0; g_otp_deadline = 0;
    drawSetupQRCode(SETUP_URL);
    publish_state("Idle");
    enter_idle_wait_for_finger();
    on_finger_wake();
    return;
  }
  if (equals("TRACK_PING")) { reply_track_now(); return; }

  // ---- Alarm: just set flags
  if (equals("ALARM_ON"))  { g_req_alarm_on  = true;  return; }
  if (equals("ALARM_OFF")) { g_req_alarm_off = true;  return; }

  // ===== Smart Display (logo/blank/text/image) — set flags only =====
  if (startsWith("DSP_MODE|")) {
    const uint16_t kPrefix = 9; // "DSP_MODE|"
    const char* mode = (len > kPrefix) ? (const char*)data + kPrefix : "";

    if      (0 == strncmp(mode, "LOGO", 4))  { g_req_mode_logo  = true; publish_state("DISPLAY_LOGO_OK");  return; }
    else if (0 == strncmp(mode, "BLANK", 5)) { g_req_mode_blank = true; publish_state("DISPLAY_BLANK_OK"); return; }
    else if (0 == strncmp(mode, "TEXT", 4))  { g_req_mode_text  = true; publish_state("DISPLAY_TEXT_MODE_OK"); return; }
    else if (0 == strncmp(mode, "IMAGE", 5)) { g_req_mode_image = true; publish_state("DISPLAY_IMAGE_MODE_OK"); return; }

    publish_state("DISPLAY_MODE_UNKNOWN");
    return;
  }

  if (startsWith("DSP_TEXT|")) {
    const uint16_t kPrefix = 9; // "DSP_TEXT|"
    size_t copyLen = (len > kPrefix) ? (len - kPrefix) : 0;
    if (copyLen >= sizeof(g_pending_display_text)) copyLen = sizeof(g_pending_display_text) - 1;

    if (copyLen > 0) {
      memcpy(g_pending_display_text, data + kPrefix, copyLen);
      g_pending_display_text[copyLen] = 0;
    } else {
      g_pending_display_text[0] = 0;
    }

    // Ensure mode is TEXT, then render in loop
    g_req_mode_text = true;
    publish_state("DISPLAY_TEXT_OK");
    return;
  }

  publish_state("CMD_UNKNOWN");
}


/* ================== BLE bring-up helpers ================== */
static void startAdvertising(bool otpMode); // fwd

static void ensure_ble_stack_inited() {
  if (g_ble_inited) return;

  // Optional throughput tweak (safe):
  // Bluefruit.configPrphBandwidth(BANDWIDTH_HIGH);

  Bluefruit.begin();
  Serial.println("[BLE] Stack up");

  // ----- Security / Pairing -----
  Bluefruit.Security.setMITM(false);
  Bluefruit.Security.setIOCaps(false, false, false);
  Bluefruit.Security.setSecuredCallback(nullptr);
  Bluefruit.Security.setPairCompleteCallback(nullptr);

  // ----- DIS / Bag ID -----
  uid64_to_hex(g_bag_id_hex);
  bledis.setManufacturer("OffStrap");
  bledis.setModel("OffStrap v1");
  bledis.setSerialNum(g_bag_id_hex);
  bledis.begin();
  Serial.print("[DIS] Serial (BagID) = "); Serial.println(g_bag_id_hex);

  // ----- Services & Characteristics -----
  secureService.begin();
  secureData.setProperties(CHR_PROPS_READ | CHR_PROPS_WRITE | CHR_PROPS_NOTIFY);
  secureData.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
  secureData.setMaxLen(160);
  secureData.setWriteCallback(secure_write_cb);
  secureData.begin();
  Serial.println("[BLE] Secure service ready");

  otpService.begin();
  otpChar.setProperties(CHR_PROPS_WRITE | CHR_PROPS_WRITE_WO_RESP);
  otpChar.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  otpChar.setWriteCallback(otp_write_cb);
  otpChar.begin();

  stateChar.setProperties(CHR_PROPS_READ | CHR_PROPS_NOTIFY);
  stateChar.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  stateChar.begin();
  Serial.println("[BLE] OTP service ready");

  // ----- Connection callbacks -----
  Bluefruit.Periph.setConnectCallback(connect_callback);
  Bluefruit.Periph.setDisconnectCallback(disconnect_callback);

  // ----- Peripheral connection params -----
  Bluefruit.Periph.setConnInterval(6 /*7.5ms*/, 80 /*100ms*/);
  Bluefruit.Periph.setConnSlaveLatency(0);
  Bluefruit.Periph.setConnSupervisionTimeout(400);

  g_ble_inited = true;
}

static void on_finger_wake() {
  Serial.println("[FP] Finger detected (stable). Powering up BLE...");
  ensure_ble_stack_inited();

  g_authorized  = false;
  g_need_otp    = false;
  g_conn_handle = BLE_CONN_HANDLE_INVALID;

  if (g_owner_mode) {
    g_in_otp_mode = false;
    publish_state("Owner mode");
    startAdvertising(false);
  } else {
    g_in_otp_mode = true;
    publish_state("Idle");
    startAdvertising(true);
  }

  g_awake        = true;
  g_wake_started = millis();
}

/* ================== GSM quiet (optional) ================== */
static String gsmReadUntilIdle(uint32_t idle_ms = 800, uint32_t overall_ms = 4000) {
  String out; unsigned long last = millis(), start = last;
  while (millis() - start < overall_ms) {
    while (Serial1.available()) { out += (char)Serial1.read(); last = millis(); }
    if (millis() - last >= idle_ms) break; delay(5);
  }
  return out;
}

// ---- ICCID decode helpers (EF 0x2FE2, BCD with swapped nibbles; 0xF is filler) ----
static int _hexVal(char c){
  if (c>='0'&&c<='9') return c-'0';
  if (c>='A'&&c<='F') return 10+(c-'A');
  if (c>='a'&&c<='f') return 10+(c-'a');
  return -1;
}
static String _extractQuotedHex(const String& s){
  int q1 = s.indexOf('"'); if (q1<0) return "";
  int q2 = s.indexOf('"', q1+1); if (q2<0) return "";
  return s.substring(q1+1, q2);
}
static String _decodeICCID_CRSM(const String& hex){
  String out; out.reserve(22);
  for (int i=0; i+1<(int)hex.length(); i+=2){
    int hi=_hexVal(hex.charAt(i)), lo=_hexVal(hex.charAt(i+1));
    if (hi<0||lo<0) break;
    int byteVal = (hi<<4)|lo;
    int lowNib  = (byteVal & 0x0F);
    int highNib = (byteVal >> 4);
    if (lowNib  != 0x0F) out += (char)('0'+lowNib);
    if (highNib != 0x0F) out += (char)('0'+highNib);
  }
  return out;
}
static String _digitsOnly(const String& s){
  String d; d.reserve(s.length());
  for (int i=0;i<(int)s.length();++i){ char c=s.charAt(i); if (c>='0'&&c<='9') d+=c; }
  return d;
}


static bool gsmAT(const char* cmd, uint32_t idle_ms = 800, const char* expect = "OK") {
  while (Serial1.available()) (void)Serial1.read();
  Serial1.print(cmd); Serial1.print("\r");
  String r = gsmReadUntilIdle(idle_ms);
  if (r.indexOf("ERROR") >= 0) return false;
  return r.indexOf(expect) >= 0;
}
static void gsm_quiet_boot_pin_swap_safe() {
#if GSM_QUIET_BOOT
  Serial1.setPins(GSM_RX_PIN, GSM_TX_PIN);
  Serial1.begin(GSM_BAUD);
  bool alive = false;
  for (int i = 0; i < 5 && !alive; i++) { alive = gsmAT("AT", 300); if (!alive) delay(120); }
  if (alive) {
    (void)gsmAT("ATE0",      400);
    (void)gsmAT("AT+CFUN=0", 4000);
    (void)gsmAT("AT+CSCLK=1",600);
  }
  Serial1.flush();
  Serial1.end();
  delay(5);
  pinMode(GSM_RX_PIN, INPUT_PULLUP);
  pinMode(GSM_TX_PIN, INPUT_PULLUP);
#endif
}

/* ================== GSM one-shot (pin-swap) helpers ================== */
// Serial1 is shared with FP. We briefly re-map to GSM pins, do ATs, then restore.

static bool gsm_swap_begin() {
  Serial1.end();
  Serial1.setPins(GSM_RX_PIN, GSM_TX_PIN);      // map Serial1 -> GSM (D0/D1)
  Serial1.begin(GSM_BAUD);
  bool alive = false;
  for (int i = 0; i < 6 && !alive; i++) {      // quick liveness
    while (Serial1.available()) (void)Serial1.read();
    Serial1.print("AT\r");
    String r = gsmReadUntilIdle(200, 600);
    alive = (r.indexOf("OK") >= 0);
    if (!alive) delay(120);
  }
  if (alive) {
    Serial1.print("ATE0\r"); (void)gsmReadUntilIdle(150, 600);
    Serial1.print("AT+CMEE=2\r"); (void)gsmReadUntilIdle(150, 600);
  }
  return alive;
}

static void gsm_swap_end_restore_fp() {
  Serial1.flush(); Serial1.end(); delay(5);
  Serial1.setPins(FP_RX_PIN, FP_TX_PIN);        // map Serial1 -> Fingerprint (D12/D11)
  Serial1.begin(FP_BAUD);
}

// Exact low-power profile we want between bursts (CFUN=1, auto-sleep on, no GNSS, LED off)
static void gsm_enter_light_sleep_profile() {
  Serial1.print("AT+CGNSPWR=0\r"); (void)gsmReadUntilIdle(120, 500);  // GNSS OFF
  Serial1.print("AT+CNETLIGHT=0\r"); (void)gsmReadUntilIdle(120, 500);// NETLIGHT OFF
  Serial1.print("AT+CSCLK=2\r"); (void)gsmReadUntilIdle(120, 500);    // auto sleep (DRX)
  // Keep CFUN=1 (registered) — no airplane here.
}

static void gsm_wake_quick() {
  Serial1.print("AT+CSCLK=0\r"); (void)gsmReadUntilIdle(120, 500);    // stop auto-sleep to read IDs
}

// One-time boot: make sure modem sits in the right sleep profile from the very start.
static void gsm_boot_to_light_sleep() {
  if (!gsm_swap_begin()) { Serial.println("[GSM] No AT at boot (skipping)"); return; }
  Serial1.print("AT+CFUN=1\r"); (void)gsmReadUntilIdle(250, 1500);     // ensure normal mode
  Serial1.print("AT+CTZU=1\r"); (void)gsmReadUntilIdle(120, 600);      // network time update
  Serial1.print("AT+CTZR=1\r"); (void)gsmReadUntilIdle(120, 600);      // tz URCs
  gsm_enter_light_sleep_profile();
  gsm_swap_end_restore_fp();
}

// Read IMEI/IMSI/ICCID/Operator in one burst, then return modem to light sleep.
static void gsm_read_sim_ids_once(String& imei, String& imsi, String& iccid, String& oper) {
  imei = imsi = iccid = oper = "";
  if (!gsm_swap_begin()) { Serial.println("[GSM] No AT for SIM IDs"); gsm_swap_end_restore_fp(); return; }

    gsm_wake_quick();

  // ---- IMEI (fallback to +GSN if needed)
  while (Serial1.available()) (void)Serial1.read();
  Serial1.print("AT+CGSN\r");
  { String r = gsmReadUntilIdle(180, 800);
    imei = _digitsOnly(r);
  }
  if (imei.length() < 14) {
    while (Serial1.available()) (void)Serial1.read();
    Serial1.print("AT+GSN\r");
    String r = gsmReadUntilIdle(180, 800);
    imei = _digitsOnly(r);
  }

  // ---- IMSI
  while (Serial1.available()) (void)Serial1.read();
  Serial1.print("AT+CIMI\r");
  { String r = gsmReadUntilIdle(180, 800);
    imsi = _digitsOnly(r);
  }

  // ---- ICCID: CCID → CICCID → CRSM(0x2FE2) 10B/20B
  auto _try_ccid = [&](int tries)->String {
    String v;
    for (int i=0; i<tries && v.length()<18; ++i){
      while (Serial1.available()) (void)Serial1.read();
      Serial1.print("AT+CCID\r");
      String r = gsmReadUntilIdle(220, 1000);
      v = _digitsOnly(r);
      if (v.length() >= 18 && v.length() <= 22) break;
      delay(200);
    }
    return v;
  };
  auto _try_ciccid = [&]()->String {
    while (Serial1.available()) (void)Serial1.read();
    Serial1.print("AT+CICCID?\r");
    String r = gsmReadUntilIdle(300, 1200);
    return _digitsOnly(r);
  };
  auto _try_crsm_iccid = [&]()->String {
    while (Serial1.available()) (void)Serial1.read();
    Serial1.print("AT+CRSM=176,12258,0,0,10\r"); // EF ICCID 0x2FE2, 10 bytes
    String r = gsmReadUntilIdle(400, 1800);
    String hex = _extractQuotedHex(r);
    String icc = _decodeICCID_CRSM(hex);
    if (icc.length() >= 18) return icc;

    while (Serial1.available()) (void)Serial1.read();
    Serial1.print("AT+CRSM=176,12258,0,0,20\r"); // up to 20 bytes
    r = gsmReadUntilIdle(600, 2200);
    hex = _extractQuotedHex(r);
    icc = _decodeICCID_CRSM(hex);
    return icc;
  };

  String _icc = _try_ccid(3);
  if (_icc.length() < 18) {
    String t = _try_ciccid(); if (t.length() >= 18) _icc = t;
  }
  if (_icc.length() < 18) {
    String t = _try_crsm_iccid(); if (t.length() >= 18) _icc = t;
  }
  if (_icc.length() < 18) {
    delay(500);
    String t = _try_ccid(1); if (t.length() >= 18) _icc = t;
  }
  iccid = _icc;

  // ---- Operator (alpha)
  while (Serial1.available()) (void)Serial1.read();
  Serial1.print("AT+COPS=3,0\r"); (void)gsmReadUntilIdle(150, 600);
  Serial1.print("AT+COPS?\r");
  { String r = gsmReadUntilIdle(220, 1000);
    int q1=r.indexOf('"'), q2=r.indexOf('"', q1+1);
    if (q1>=0 && q2>q1) oper = r.substring(q1+1,q2);
  }

  // Back to proper sleep
  gsm_enter_light_sleep_profile();
  gsm_swap_end_restore_fp();

  // Basic sanity clamps (avoid huge notifications)
  if (imei.length()  > 20) imei.remove(20);
  if (imsi.length()  > 20) imsi.remove(20);
  if (iccid.length() > 22) iccid.remove(22);
  if (oper.length()  > 24) oper.remove(24);
}

/* ================== Setup / Loop ================== */
void setup() {
  Serial.begin(115200); delay(50);
  Serial.println("=== OffStrap starting — route by owner flag (no FP wipe in owner mode) ===");

  pinMode(FP_PWR_PIN, OUTPUT);
  digitalWrite(FP_PWR_PIN, HIGH);  // D6 HIGH = power OFF

  // Quiet GSM (optional)
  gsm_quiet_boot_pin_swap_safe();
  //gsm_boot_to_light_sleep();

  // DET pin
#if FP_DET_ACTIVE_HIGH
  pinMode(FP_INT_PIN, INPUT_PULLDOWN); // HIGH = finger present
#else
  pinMode(FP_INT_PIN, INPUT_PULLUP);   // LOW = finger present
#endif

  // Fingerprint UART
  FP_SERIAL.setPins(FP_RX_PIN, FP_TX_PIN);
  FP_SERIAL.begin(FP_BAUD);

  // Security level 1 (fingerprint module)
  // Security level 1 (fingerprint module) — power ON only for transaction
fp_session_begin("boot:set_security");
clearFpRx(); send_cmd2(CMD_SET_SYSPARA, 5);
clearFpRx();
{
  uint16_t length   = 5; uint8_t cmd = CMD_SET_SYSPARA; uint8_t p1=5, p2=1;
  uint16_t checksum = 1 + length + cmd + p1 + p2;
  uint8_t pkt[14];
  pkt[0]=HEADER_HIGH; pkt[1]=HEADER_LOW;
  pkt[2]=(DEVICE_ADDRESS>>24)&0xFF; pkt[3]=(DEVICE_ADDRESS>>16)&0xFF;
  pkt[4]=(DEVICE_ADDRESS>>8)&0xFF;  pkt[5]=(DEVICE_ADDRESS)&0xFF;
  pkt[6]=0x01; pkt[7]=(length>>8)&0xFF; pkt[8]=length&0xFF;
  pkt[9]=cmd; pkt[10]=p1; pkt[11]=p2; pkt[12]=(checksum>>8)&0xFF; pkt[13]=checksum&0xFF;
  FP_SERIAL.write(pkt, sizeof(pkt));
  if (receiveOK(400)) Serial.println(" [ACK] FP security level set to 1");
}
fp_session_end("boot:set_security");


  // E-paper + BLE stack
  epd_init_fast();
  ensure_ble_stack_inited();

  // Owner flag
  bool isOwner = owner_flag_get();
  g_owner_mode = isOwner;
  Serial.print("[BOOT] Owner flag = "); Serial.println(isOwner ? "ON" : "OFF");

  if (!isOwner) {
  fp_session_begin("boot:shipping_clear");
  bool cleared = fp_clear_database_strict();
  Serial.print("[BOOT] Finger DB clear (shipping): "); Serial.println(cleared ? "OK" : "FAILED");
  int count = readTemplateCount();
  fp_session_end("boot:shipping_clear");
  Serial.print("[BOOT] Templates after clear = "); Serial.println(count);
} else {
  fp_session_begin("boot:owner_count");
  int count = readTemplateCount();
  fp_session_end("boot:owner_count");
  Serial.print("[BOOT] Owner mode: keeping FP DB intact. Templates = "); Serial.println(count);
}


  if (isOwner) {
    printBrandScreen(true);
    g_disp_mode = DISP_LOGO; // track current screen

    g_authorized  = false;
    g_need_otp    = false;
    g_conn_handle = BLE_CONN_HANDLE_INVALID;
    g_in_otp_mode = false;

    int count = readTemplateCount();
    Serial.print("[BOOT] Owner mode → Templates present = "); Serial.println(count);

    publish_state("Owner mode");
    startAdvertising(false); // SECURE adv
    g_awake        = true;
    g_wake_started = millis();

    Serial.println("[BOOT] Owner-bound: SECURE advertising started.");
  } else {
  drawSetupQRCode(SETUP_URL);
  Serial.println("[EPD] Setup QR shown");

  Serial.println("[BOOT] Shipping mode: waiting for finger DET.");
  fp_session_begin("boot:wait_for_finger");
  enter_idle_wait_for_finger();
  // We keep power ON through the wake boundary so MATCH/ENROLL can start immediately if needed.
  on_finger_wake();
  fp_session_end("boot:wait_for_finger");
}
}

void loop() {
  // Buzzer service (non-blocking)
  buzzer_service();

  // ===== Deferred actions from BLE callback =====
  if (g_req_alarm_on)  { g_req_alarm_on = false; buzzer_start(); }
  if (g_req_alarm_off) { g_req_alarm_off = false; buzzer_stop(); }

  if (g_req_mode_logo) {
    g_req_mode_logo = false;
    g_disp_mode = DISP_LOGO;
    printBrandScreen(true);
  }
  if (g_req_mode_blank) {
    g_req_mode_blank = false;
    g_disp_mode = DISP_BLANK;
    epd_show_blank_black();
  }
  if (g_req_mode_text) {
    g_req_mode_text = false;
    g_disp_mode = DISP_TEXT;
    if (g_pending_display_text[0]) {
      strncpy(g_display_text, g_pending_display_text, sizeof(g_display_text));
      g_display_text[sizeof(g_display_text)-1] = 0;
    }
    epd_show_centered_text_white_on_black_18(g_display_text);
  }
  if (g_req_mode_image) {
    g_req_mode_image = false;
    g_disp_mode = DISP_IMAGE;
    // reserved—show logo for now
    printBrandScreen(true);
  }

  if (g_req_lost_on) {
    g_req_lost_on = false;
    // nothing to render yet; wait for LOST_NAME/PHONE then g_req_lost_render
  }
  if (g_req_lost_render && g_lost_mode_active) {
    g_req_lost_render = false;
    epd_show_lost_mode(g_lost_name, g_lost_phone);
    publish_state("LOST_MODE_SHOWN");
  }
  if (g_req_lost_off) {
    g_req_lost_off = false;
    // Restore what was shown before LOST_ON
    if (g_prev_mode_valid) {
      g_disp_mode = g_prev_mode_before_lost;
      g_prev_mode_valid = false;
      render_current_display_mode();
    } else {
      printBrandScreen(true);
    }
  }

  // ===== Manage ADV fast → slow window in background =====
  if (g_conn_handle == BLE_CONN_HANDLE_INVALID && g_adv_fast_active) {
    if (millis() - g_adv_fast_start > ADV_FAST_WINDOW_MS) {
      Serial.println("[BLE] Fast window elapsed → switching to SLOW advertising");
      Bluefruit.Advertising.stop();
      set_adv_profile_slow();
      Bluefruit.Advertising.start(0);
      g_adv_pulse_until = 0;
      g_adv_last_pulse  = millis();
    }
  }
  if (g_conn_handle == BLE_CONN_HANDLE_INVALID && !g_adv_fast_active) {
    if (millis() - g_adv_last_pulse > ADV_PULSE_PERIOD_MS) {
      Bluefruit.Advertising.stop();
      set_adv_profile_fast();         // enter FAST
      Bluefruit.Advertising.start(0);
      g_adv_pulse_until = millis() + ADV_PULSE_LEN_MS;
      g_adv_last_pulse  = millis();
      Serial.println("[BLE] Pulse: FAST burst");
    }
  }

  // End FAST pulse → back to SLOW
  if (g_conn_handle == BLE_CONN_HANDLE_INVALID && g_adv_fast_active && g_adv_pulse_until != 0) {
    if ((int32_t)(millis() - g_adv_pulse_until) >= 0) {
      Bluefruit.Advertising.stop();
      set_adv_profile_slow();         // return to SLOW
      Bluefruit.Advertising.start(0);
      g_adv_pulse_until = 0;
      Serial.println("[BLE] Pulse: back to SLOW");
    }
  }

  // OTP on first connect in OTP mode
  if (g_need_otp && g_conn_handle != BLE_CONN_HANDLE_INVALID) {
    g_need_otp     = false;
    g_authorized   = false;
    g_expected_otp = generate_6digit_otp();
    g_otp_deadline = millis() + OTP_WINDOW_MS;
    Serial.print("[OTP] New code = "); Serial.println(g_expected_otp);
    show_otp_on_epaper(g_expected_otp);
    publish_state("Enter OTP");
  }

  // Switch to SECURE advertising once encrypted (first-time OTP path)
  if (g_authorized && g_in_otp_mode && g_conn_handle != BLE_CONN_HANDLE_INVALID) {
  BLEConnection* c = Bluefruit.Connection(g_conn_handle);
  if (c && c->secured()) {
    publish_state("Secure link ready");
    Serial.println("[DBG] Link is now secured (encrypted).");

    // ---- ONE-SHOT: BagID + SIM IDs (SHIPPING ONLY) ----
    // ---- ONE-SHOT: Minimal BagID + ICCID packet ----
{
  static bool sent_provision_once = false;
  if (!sent_provision_once) {
    clearFpRx();

    String imei, imsi, iccid, oper;
    gsm_read_sim_ids_once(imei, imsi, iccid, oper);

    // 1) Send BagID alone
    char j1[40];
    snprintf(j1, sizeof(j1), "{\"bagId\":\"%s\"}", g_bag_id_hex);
    secure_send_text(j1);
    Serial.print("[PROVISION] "); Serial.println(j1);

    // small breather so the central sees two distinct notifies
    delay(40);

    // 2) Send ICCID alone (only if we actually have it)
    if (iccid.length() >= 18) {
      char j2[40];
      // ICCID is up to ~20 digits; 40B buffer is plenty
      snprintf(j2, sizeof(j2), "{\"iccid\":\"%s\"}", iccid.c_str());
      secure_send_text(j2);
      Serial.print("[PROVISION] "); Serial.println(j2);
    } else {
      Serial.println("[PROVISION] ICCID missing/short — skipped");
    }

    sent_provision_once = true;
  }
}


    owner_flag_set(true);
    Serial.println("[OWNER] Flag set -> future boots will start in owner mode.");

    g_in_otp_mode = false;
    startAdvertising(false);
    printBrandScreen(true);
    g_disp_mode = DISP_LOGO;
  }
}

  // --- Owner-mode: auto-authorize on encrypted reconnects (no OTP) ---
  if (!g_in_otp_mode && g_conn_handle != BLE_CONN_HANDLE_INVALID) {
    BLEConnection* c = Bluefruit.Connection(g_conn_handle);
    if (c && c->secured() && !g_authorized) {
      g_authorized = true;
      publish_state("Authorized");
      Serial.println("[AUTH] Bonded peer reconnected (encrypted). Auto-authorized.");
    }
  }

  // --- Owner-mode: boot strangers quickly to save power (no encryption within grace) ---
  if (!g_in_otp_mode && g_conn_handle != BLE_CONN_HANDLE_INVALID) {

  // Do NOT kick while fingerprint enrollment/verify is running
  if (g_enroll_active || g_verify_pending) {
    // skip stranger eject during FP flow
  } else {
    BLEConnection* c = Bluefruit.Connection(g_conn_handle);
    if (c && !c->secured()) {
      if (millis() - g_conn_time_ms > ENCRYPT_GRACE_MS) {
        Serial.println("[SEC] Unencrypted peer after grace -> disconnect to save power");
        Bluefruit.disconnect(g_conn_handle);
      }
    }
  }
}

  // Idle timeout → only for SHIPPING mode
  if (!g_owner_mode && g_awake && g_conn_handle == BLE_CONN_HANDLE_INVALID &&
      (millis() - g_wake_started) > WAKE_WINDOW_MS) {
    if (!g_enroll_active && !g_verify_pending) {
      Serial.println("[PM] No connection within 3 minutes after finger. Going idle.");
      publish_state("Idle");
      Bluefruit.Advertising.stop();
      g_awake=false; g_need_otp=false; g_authorized=false;
      g_expected_otp=0; g_otp_deadline=0;
      drawSetupQRCode(SETUP_URL);
      enter_idle_wait_for_finger();
      on_finger_wake();
    }
  }

  // OTP timeout notice
  if (g_in_otp_mode && !g_authorized && g_conn_handle != BLE_CONN_HANDLE_INVALID && millis() > g_otp_deadline) {
    static bool said = false;
    if (!said) { publish_state("OTP timeout"); said = true; Serial.println("[OTP] Timed out"); }
  }

  // Run enrollment when requested
  if (g_enroll_requested) {
    g_enroll_requested = false;
    (void)run_enrollment_5_strict();
  }
}
