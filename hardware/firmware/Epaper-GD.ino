#include <GxEPD2_BW.h>
#include "FreeSansBold3pt7b.h"
#include "FreeSans12pt7b.h"

// ==== Display: GDEY029T71H (168x384), SSD1685 ====
GxEPD2_BW<GxEPD2_290_GDEY029T71H, GxEPD2_290_GDEY029T71H::HEIGHT>
display(GxEPD2_290_GDEY029T71H(/*CS=*/19, /*DC=*/18, /*RST=*/17, /*BUSY=*/16));

// --- Orientation control (matches your main code style) ---
static const uint8_t BASE_ROT     = 1;   // landscape baseline
static const bool    EPD_FLIP_180 = true; // set true to rotate 180°

static const char MSG_BRAND[]   = "OFFSTRAP";
static const char MSG_TAGLINE[] = "Smart. Secure. Connected.";

// ---------- helpers ----------
static void centerText(const char* text, int16_t y) {
  int16_t x1, y1; uint16_t w, h;
  display.getTextBounds(text, 0, y, &x1, &y1, &w, &h);
  int16_t x = (display.width() - w) / 2;
  display.setCursor(x, y);
  display.print(text);
}

void printBrandScreen(bool inverted) {
  // Apply 180° flip if requested
  uint8_t rot = (BASE_ROT + (EPD_FLIP_180 ? 2 : 0)) % 4;
  display.setRotation(rot);
  display.setFullWindow();

  const int16_t H = display.height();   // 168
  const int16_t W = display.width();    // 384
  const int16_t bottomPadding = 12;     // gap from very bottom for tagline
  const int16_t brandTargetY  = H / 2;  // center baseline for the logo

  display.firstPage();
  do {
    if (inverted) { display.fillScreen(GxEPD_BLACK); display.setTextColor(GxEPD_WHITE); }
    else          { display.fillScreen(GxEPD_WHITE); display.setTextColor(GxEPD_BLACK); }

    // Logo: FreeSans Bold 32pt
    display.setFont(&FreeSansBold34pt7b);
    centerText(MSG_BRAND, brandTargetY);

    // Tagline: FreeSans Bold 12pt, near bottom
    display.setFont(&FreeSans12pt7b);
    int16_t x1, y1; uint16_t tw, th;
    display.getTextBounds(MSG_TAGLINE, 0, 0, &x1, &y1, &tw, &th);
    int16_t taglineY = H - bottomPadding;
    centerText(MSG_TAGLINE, taglineY);

  } while (display.nextPage());
}

void setup() {
  Serial.begin(115200);
  display.init(115200, true, 2, false);
  printBrandScreen(true);  // inverted: black bg / white text
}

void loop() { }
