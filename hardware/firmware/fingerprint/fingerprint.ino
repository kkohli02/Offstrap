// *** IMPORTANT ***
// Tools → USB Stack → TinyUSB
#include <Adafruit_TinyUSB.h>
#include <stdint.h>

// =================== Wiring ===================
// ZW0642 Pin4 TXD -> Feather D5  (MCU RX)
// ZW0642 Pin5 RXD -> Feather D6  (MCU TX)
// ZW0642 Pin2 DET -> Feather D10 (Detect)
// ZW0642 Pin1/3   -> 3V
// ZW0642 Pin6     -> GND

// -------- Pin definitions (Feather nRF52840) --------
static const uint8_t FP_RX_PIN  = 12;    // Feather D5  (MCU RX)
static const uint8_t FP_TX_PIN  = 11;    // Feather D6  (MCU TX)
static const uint8_t FP_INT_PIN = 13;    // Feather D10 (Detect)

#define FP_SERIAL Serial1
static const uint32_t FP_BAUD = 57600;

// ========== Config toggles ==========
#define FP_DET_ACTIVE_HIGH   1         // 1: DET=HIGH means finger present. 0: DET=LOW means finger present.
#define SLEEP_IDLE_MS        5000      // auto-sleep after this idle time (ms)
#define FP_SEND_NUDGE_WAKE   1         // send a dummy byte on wake to resync UART
#define FP_USE_POWER_GATE    0         // 1 to use power gate helpers; requires FP_POWER_PIN >= 01
#define FP_POWER_PIN         -1        // set to your load-switch pin if you wire one (e.g., 9)

// --- DET wake handling (anti-chatter) ---
static const uint16_t DET_ACTIVE_STABLE_MS = 40;   // require DET active for this long
static const uint8_t  DET_SAMPLES          = 8;    // samples during debounce

// -------- ZW0642 packet constants --------
const uint8_t  HEADER_HIGH     = 0xEF;
const uint8_t  HEADER_LOW      = 0x01;
const uint32_t DEVICE_ADDRESS  = 0xFFFFFFFF;

// Command codes (per manual)
const uint8_t CMD_GET_IMAGE     = 0x01;
const uint8_t CMD_GEN_CHAR      = 0x02;
const uint8_t CMD_MATCH         = 0x03;
const uint8_t CMD_SEARCH        = 0x04;
const uint8_t CMD_REG_MODEL     = 0x05;
const uint8_t CMD_STORE_CHAR    = 0x06;
const uint8_t CMD_CLEAR_LIB     = 0x0D;
const uint8_t CMD_SET_SYSPARA   = 0x0E;
const uint8_t CMD_READ_SYSPARA  = 0x0F;
const uint8_t CMD_TEMPLATE_NUM  = 0x1D; // Read valid template count
const uint8_t CMD_READ_INDEX    = 0x1F; // Read index table
const uint8_t CMD_SLEEP         = 0x33; // PS_Sleep (datasheet)

// --------- State ---------
enum FPState : uint8_t { FP_ACTIVE=0, FP_SLEEPING=1, FP_OFF=2 };
volatile bool g_detEdge = false;
FPState g_fpState = FP_ACTIVE;
bool    isInit       = false;
bool    busyOp       = false;   // prevent autosleep mid-enroll/search
uint32_t lastActivityMs = 0;

uint8_t  BUFFER_ID = 1;
const uint16_t SEARCH_START_PAGE = 0;
const uint16_t SEARCH_NUM_PAGES  = 1000;
uint16_t g_capacity = 0; // filled from READ_SYSPARA

// ------------ Prototypes ------------
void printMenu();
int  runCommandMenu();
int  readModuleInfo();
bool registerFP();                // one-touch enroll
bool searchFP();
bool clearAll();

bool waitForFinger(uint32_t timeout_ms = 10000);
bool waitForFingerGone(uint32_t timeout_ms = 10000);

bool captureToCharBuffer(uint8_t bufId, uint8_t maxAttempts = 3); // NEW

void clearFpRx();
void send_cmd(uint8_t cmd);
void send_cmd2(uint8_t cmd, uint8_t p1);
void send_cmd3(uint8_t cmd, uint8_t p1, uint16_t p2);
void send_cmd4(uint8_t cmd, uint8_t p1, uint16_t p2, uint16_t p3);
void send_cmd2bytes(uint8_t cmd, uint8_t p1, uint8_t p2);
bool receiveOK(uint32_t timeout_ms = 1000);

int  readTemplateCount();
bool readIndexPage(uint8_t page, uint8_t out32[32]);
int  findNextFreeID();            // now returns >= 1 (skips 0)

bool enterSleep();
bool wakeFromSleep();

// DET helpers
void onDetEdge() { g_detEdge = true; }
inline bool detIsActive() {
  #if FP_DET_ACTIVE_HIGH
    return digitalRead(FP_INT_PIN) == HIGH;
  #else
    return digitalRead(FP_INT_PIN) == LOW;
  #endif
}
void armDetInterrupt(bool enable) {
  if (enable) {
    g_detEdge = false;
    #if FP_DET_ACTIVE_HIGH
      attachInterrupt(digitalPinToInterrupt(FP_INT_PIN), onDetEdge, RISING);
    #else
      attachInterrupt(digitalPinToInterrupt(FP_INT_PIN), onDetEdge, FALLING);
    #endif
  } else {
    detachInterrupt(digitalPinToInterrupt(FP_INT_PIN));
    g_detEdge = false;
  }
}
bool detActiveStable() {
  uint32_t start = millis();
  uint8_t ok = 0;
  while (millis() - start < DET_ACTIVE_STABLE_MS) {
    if (detIsActive()) ok++;
    delay(DET_ACTIVE_STABLE_MS / DET_SAMPLES);
  }
  return ok >= (DET_SAMPLES * 3 / 4); // ≥75% samples active
}

// Power gating (optional)
#if FP_USE_POWER_GATE
void powerOnSensor();
void powerOffSensor();
#endif

// ---------------- Setup / Loop ----------------
void setup() {
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && (millis() - t0 < 2000)) { delay(10); }

#if FP_USE_POWER_GATE
  if (FP_POWER_PIN >= 0) {
    pinMode(FP_POWER_PIN, OUTPUT);
    digitalWrite(FP_POWER_PIN, HIGH); // assume HIGH = ON for load switch
  }
#endif

#if FP_DET_ACTIVE_HIGH
  pinMode(FP_INT_PIN, INPUT_PULLDOWN);   // HIGH means finger present
#else
  pinMode(FP_INT_PIN, INPUT_PULLUP);     // LOW means finger present
#endif
  // NOTE: do NOT attach interrupt here. We arm it only after sleep ACK.

  FP_SERIAL.setPins(FP_RX_PIN, FP_TX_PIN);  // MUST be before begin() on nRF52
  FP_SERIAL.begin(FP_BAUD);

  Serial.println("\n[ZW0642 Demo] Feather nRF52840 (PS_Sleep=0x33, debounced DET)");
  Serial.println("Pins: RX=D5, TX=D6, DET=D10\n");

  // Set security level to 1 (takes effect after module power cycle)
  clearFpRx();
  send_cmd2bytes(CMD_SET_SYSPARA, 5, 1);  // param#:5 -> security level, value=1 (lowest)
  if (receiveOK()) {
    Serial.println("  [ACK] Set security level -> 1 (takes effect after module power cycle).");
  } else {
    Serial.println("  [WARN] Failed to set security level.");
  }

  lastActivityMs = millis();
}

void loop() {
  // Handle verified DET wake while sleeping
  if (g_fpState == FP_SLEEPING && (g_detEdge || detIsActive())) {
    if (wakeFromSleep()) {
      Serial.println("[WAKE] Verified DET wake.");
    }
  }

  if (!isInit) {
    isInit = true;
    readModuleInfo();
    printMenu();
  }

  runCommandMenu();

  // Auto-sleep when idle and not in an operation
  if (!busyOp && g_fpState == FP_ACTIVE) {
    bool fingerPresent = detIsActive();
    if (!fingerPresent && (millis() - lastActivityMs) > SLEEP_IDLE_MS) {
      if (enterSleep()) {
        Serial.println("[SLEEP] Entered sleep (ACK).");
        // Interrupt is armed inside enterSleep()
      } else {
        Serial.println("[SLEEP] No ACK / still awake.");
      }
    }
  }

  delay(20);
}

// ---------------- Menu / Commands ----------------
void printMenu() {
  Serial.println("------------------------------------------");
  Serial.println("Serial commands:");
  Serial.println("  1 - Register (ONE-TOUCH enroll: keep finger once)");
  Serial.println("  2 - Search / Match fingerprint");
  Serial.println("  3 - Clear fingerprint database");
  Serial.println("  4 - Force sleep");
  Serial.println("  5 - Wake test (nudge + probe)");
#if FP_USE_POWER_GATE
  Serial.println("  6 - Power OFF sensor");
  Serial.println("  7 - Power ON sensor");
#endif
  Serial.println("------------------------------------------");
}

int runCommandMenu() {
  if (!Serial.available()) return 0;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();

  if (g_fpState == FP_SLEEPING && (cmd == "1" || cmd == "2" || cmd == "3" || cmd == "5")) {
    (void)wakeFromSleep();
  }

  if (cmd == "1") {
    Serial.println("[INFO] Registering (one-touch: two captures while you KEEP the finger)...");
    busyOp = true;
    bool ok = registerFP();
    busyOp = false;
    Serial.println(ok ? "[OK] Registration complete." : "[FAIL] Registration failed.");
  } else if (cmd == "2") {
    Serial.println("[INFO] Searching...");
    busyOp = true;
    bool ok = searchFP();
    busyOp = false;
    Serial.println(ok ? "[OK] Match found." : "[INFO] No match.");
  } else if (cmd == "3") {
    Serial.println("[INFO] Clearing database...");
    busyOp = true;
    bool ok = clearAll();
    busyOp = false;
    Serial.println(ok ? "[OK] Database cleared." : "[FAIL] Clear failed.");
  } else if (cmd == "4") {
    Serial.println("[INFO] Forcing sleep...");
    bool ok = enterSleep();
    Serial.println(ok ? "[OK] Sleep ACK." : "[WARN] Sleep not acknowledged.");
#if FP_USE_POWER_GATE
  } else if (cmd == "6") {
    Serial.println("[INFO] Power OFF sensor...");
    powerOffSensor();
  } else if (cmd == "7") {
    Serial.println("[INFO] Power ON sensor...");
    powerOnSensor();
#endif
  } else if (cmd.length()) {
    Serial.print("[ERROR] Unknown command: ");
    Serial.println(cmd);
  }
  lastActivityMs = millis();
  return 1;
}

// ---------------- Module Info ----------------
int readModuleInfo() {
  clearFpRx();
  send_cmd(CMD_READ_SYSPARA);

  uint8_t resp[64] = {0};
  uint8_t idx = 0;
  uint32_t start = millis();
  while (millis() - start < 1000 && idx < sizeof(resp)) {
    if (FP_SERIAL.available()) resp[idx++] = FP_SERIAL.read();
  }

  if (idx >= 28 && resp[9] == 0x00) {
    uint16_t fp_temp_size = (uint16_t)(resp[12] << 8) | resp[13];
    uint16_t fp_lib_size  = (uint16_t)(resp[14] << 8) | resp[15];
    uint16_t score_level  = (uint16_t)(resp[16] << 8) | resp[17];
    uint32_t device_addr  = (uint32_t)(resp[18] << 24) | (resp[19] << 16) | (resp[20] << 8) | resp[21];
    uint16_t data_pack_sz = (uint16_t)(resp[22] << 8) | resp[23];
    switch (data_pack_sz) {
      case 0: data_pack_sz = 32;  break;
      case 1: data_pack_sz = 64;  break;
      case 2: data_pack_sz = 128; break;
      case 3: data_pack_sz = 256; break;
    }
    uint16_t baud_set = (uint16_t)(resp[24] << 8) | resp[25];

    g_capacity = fp_lib_size;

    Serial.println("Fingerprint Module Info:");
    int valid = readTemplateCount();
    if (valid >= 0) { Serial.print("  Valid templates: "); Serial.println(valid); }
    else            { Serial.println("  Valid templates: [unknown]"); }

    Serial.print("  Template size (hex): 0x");   Serial.println(fp_temp_size, HEX);
    Serial.print("  Database size: ");           Serial.println(fp_lib_size);
    Serial.print("  Security level: ");          Serial.println(score_level);
    Serial.print("  Device address: 0x");        Serial.println(device_addr, HEX);
    Serial.print("  Data packet size: ");        Serial.println(data_pack_sz);
    Serial.print("  Baud rate: ");               Serial.println(baud_set * 9600UL);
    lastActivityMs = millis();
    return 1;
  } else {
    Serial.println("[WARN] Failed to read module info.");
    return 0;
  }
}

// ---------------- Wait helpers ----------------
bool waitForFinger(uint32_t timeout_ms) {
  uint32_t start = millis();
  while (true) {
    if (detIsActive()) break;
    if (millis() - start > timeout_ms) {
      Serial.println("  [TIMEOUT] No finger detected.");
      return false;
    }
    delay(5);
  }
  lastActivityMs = millis();
  Serial.println("  [OK] Finger detected. KEEP your finger steady...");
  return true;
}

bool waitForFingerGone(uint32_t timeout_ms) {
  uint32_t start = millis();
  while (true) {
    if (!detIsActive()) break;
    if (millis() - start > timeout_ms) {
      Serial.println("  [TIMEOUT] Finger not removed.");
      return false;
    }
    delay(5);
  }
  lastActivityMs = millis();
  return true;
}

// ---------------- Capture helper (NEW) ----------------
bool captureToCharBuffer(uint8_t bufId, uint8_t maxAttempts) {
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

// ---------------- High-level ops ----------------
bool registerFP() {
  const uint8_t MAX_ATTEMPTS = 5;

  int targetID = findNextFreeID();
  if (targetID < 1) {
    Serial.println("  [ERR] No free template slot (or capacity unknown).");
    return false;
  }
  Serial.print("  [INFO] Storing to ID: "); Serial.println(targetID);

  Serial.println("  Place and KEEP the finger on sensor...");
  if (!waitForFinger(10000)) return false;

  // Two captures while the finger REMAINS on the sensor
  if (!captureToCharBuffer(1, MAX_ATTEMPTS)) {
    Serial.println("  [ERR] First capture failed. Try again.");
    return false;
  }

  // Small settle, ensure still present; if user lifted, request to keep again quickly.
  delay(250);
  if (!detIsActive()) {
    Serial.println("  [HINT] Please keep your finger steady...");
    if (!waitForFinger(3000)) return false;
  }

  if (!captureToCharBuffer(2, MAX_ATTEMPTS)) {
    Serial.println("  [ERR] Second capture failed. Try again.");
    return false;
  }

  // Now ask user to remove finger, then merge & store
  Serial.println("  Remove finger...");
  (void)waitForFingerGone(5000); // proceed even if user is slow; not critical now

  // Merge & store
  clearFpRx();
  send_cmd(CMD_REG_MODEL);
  if (!receiveOK(600)) {
    Serial.println("  [ERR] Merge REG_MODEL failed.");
    return false;
  }

  clearFpRx();
  send_cmd3(CMD_STORE_CHAR, 1, (uint16_t)targetID); // store from buffer 1 to targetID
  bool ok = receiveOK(600);
  lastActivityMs = millis();
  return ok;
}

bool searchFP() {
  const uint8_t MAX_ATTEMPTS = 5;

  Serial.println("  Place finger on sensor...");
  if (!waitForFinger(10000)) return false;

  if (!captureToCharBuffer(1, MAX_ATTEMPTS)) return false;

  clearFpRx();
  send_cmd4(CMD_SEARCH, 1, SEARCH_START_PAGE, SEARCH_NUM_PAGES);
  bool ok = receiveOK();
  lastActivityMs = millis();
  return ok;
}

bool clearAll() {
  clearFpRx();
  send_cmd(CMD_CLEAR_LIB);
  bool ok = receiveOK();
  lastActivityMs = millis();
  return ok;
}

// ---------------- Sleep / Wake ----------------
bool enterSleep() {
  clearFpRx();
  send_cmd(CMD_SLEEP);          // 0x33 per datasheet (PS_Sleep)
  bool ok = receiveOK(200);     // confirm code 00H => success
  if (ok) {
    g_fpState = FP_SLEEPING;
    armDetInterrupt(true);      // DET is only valid after sleep — arm now
  }
  return ok;
}

bool wakeFromSleep() {
  if (g_fpState != FP_SLEEPING) return true;

  // If ISR flagged or DET looks active, verify stability
  if (!g_detEdge && !detIsActive()) return false;
  if (!detActiveStable()) {
    // Noise; stay asleep
    g_detEdge = false;
    return false;
  }

  armDetInterrupt(false);       // stop spurious interrupts
  delay(80);                    // small settle

#if FP_SEND_NUDGE_WAKE
  uint8_t d = 0x00;
  FP_SERIAL.write(&d, 1);       // harmless nudge helps some clones
  delay(5);
#endif

  clearFpRx();
  send_cmd(CMD_READ_SYSPARA);
  (void)receiveOK(200);         // ignore result; helps resync
  g_fpState = FP_ACTIVE;
  lastActivityMs = millis();
  return true;
}

// ---------------- Packet I/O ----------------
void clearFpRx() { while (FP_SERIAL.available()) (void)FP_SERIAL.read(); }

void send_cmd(uint8_t cmd) {
  uint16_t length   = 3;
  uint16_t checksum = 1 + length + cmd;

  uint8_t pkt[12];
  pkt[0] = HEADER_HIGH; pkt[1] = HEADER_LOW;
  pkt[2] = (DEVICE_ADDRESS >> 24) & 0xFF;
  pkt[3] = (DEVICE_ADDRESS >> 16) & 0xFF;
  pkt[4] = (DEVICE_ADDRESS >> 8)  & 0xFF;
  pkt[5] = (DEVICE_ADDRESS)       & 0xFF;
  pkt[6] = 0x01; // command packet
  pkt[7] = (length >> 8) & 0xFF;  pkt[8] = length & 0xFF;
  pkt[9] = cmd;
  pkt[10] = (checksum >> 8) & 0xFF; pkt[11] = checksum & 0xFF;
  FP_SERIAL.write(pkt, sizeof(pkt));
}

void send_cmd2(uint8_t cmd, uint8_t p1) {
  uint16_t length   = 4;
  uint16_t checksum = 1 + length + cmd + p1;

  uint8_t pkt[13];
  pkt[0] = HEADER_HIGH; pkt[1] = HEADER_LOW;
  pkt[2] = (DEVICE_ADDRESS >> 24) & 0xFF;
  pkt[3] = (DEVICE_ADDRESS >> 16) & 0xFF;
  pkt[4] = (DEVICE_ADDRESS >> 8)  & 0xFF;
  pkt[5] = (DEVICE_ADDRESS)       & 0xFF;
  pkt[6] = 0x01;
  pkt[7] = (length >> 8) & 0xFF;  pkt[8] = length & 0xFF;
  pkt[9] = cmd; pkt[10] = p1;
  pkt[11] = (checksum >> 8) & 0xFF; pkt[12] = checksum & 0xFF;
  FP_SERIAL.write(pkt, sizeof(pkt));
}

void send_cmd3(uint8_t cmd, uint8_t p1, uint16_t p2) {
  uint16_t length   = 6;
  uint16_t checksum = 1 + length + cmd + p1 + (p2 >> 8) + (p2 & 0xFF);

  uint8_t pkt[15];
  pkt[0] = HEADER_HIGH; pkt[1] = HEADER_LOW;
  pkt[2] = (DEVICE_ADDRESS >> 24) & 0xFF;
  pkt[3] = (DEVICE_ADDRESS >> 16) & 0xFF;
  pkt[4] = (DEVICE_ADDRESS >> 8)  & 0xFF;
  pkt[5] = (DEVICE_ADDRESS)       & 0xFF;
  pkt[6] = 0x01;
  pkt[7] = (length >> 8) & 0xFF;  pkt[8] = length & 0xFF;
  pkt[9]  = cmd; 
  pkt[10] = p1;
  pkt[11] = (p2 >> 8) & 0xFF;     
  pkt[12] = p2 & 0xFF;
  pkt[13] = (checksum >> 8) & 0xFF; 
  pkt[14] = checksum & 0xFF;
  FP_SERIAL.write(pkt, sizeof(pkt));
}

void send_cmd4(uint8_t cmd, uint8_t p1, uint16_t p2, uint16_t p3) {
  uint16_t length   = 8;
  uint16_t checksum = 1 + length + cmd + p1 +
                      (p2 >> 8) + (p2 & 0xFF) +
                      (p3 >> 8) + (p3 & 0xFF);

  uint8_t pkt[17];
  pkt[0] = HEADER_HIGH; pkt[1] = HEADER_LOW;
  pkt[2] = (DEVICE_ADDRESS >> 24) & 0xFF;
  pkt[3] = (DEVICE_ADDRESS >> 16) & 0xFF;
  pkt[4] = (DEVICE_ADDRESS >> 8)  & 0xFF;
  pkt[5] = (DEVICE_ADDRESS)       & 0xFF;
  pkt[6] = 0x01;
  pkt[7] = (length >> 8) & 0xFF;  pkt[8] = length & 0xFF;
  pkt[9] = cmd; pkt[10] = p1;
  pkt[11] = (p2 >> 8) & 0xFF;     pkt[12] = p2 & 0xFF;
  pkt[13] = (p3 >> 8) & 0xFF;     pkt[14] = p3 & 0xFF;
  pkt[15] = (checksum >> 8) & 0xFF; pkt[16] = checksum & 0xFF;
  FP_SERIAL.write(pkt, sizeof(pkt));
}

void send_cmd2bytes(uint8_t cmd, uint8_t p1, uint8_t p2) {
  uint16_t length   = 5;                          // cmd + p1 + p2 + 2-byte checksum
  uint16_t checksum = 1 + length + cmd + p1 + p2;

  uint8_t pkt[14];
  pkt[0] = HEADER_HIGH; pkt[1] = HEADER_LOW;
  pkt[2] = (DEVICE_ADDRESS >> 24) & 0xFF;
  pkt[3] = (DEVICE_ADDRESS >> 16) & 0xFF;
  pkt[4] = (DEVICE_ADDRESS >> 8)  & 0xFF;
  pkt[5] = (DEVICE_ADDRESS)       & 0xFF;
  pkt[6] = 0x01;
  pkt[7] = (length >> 8) & 0xFF;  pkt[8] = length & 0xFF;
  pkt[9]  = cmd;
  pkt[10] = p1;                    // parameter number (per manual)
  pkt[11] = p2;                    // value
  pkt[12] = (checksum >> 8) & 0xFF;
  pkt[13] = checksum & 0xFF;
  FP_SERIAL.write(pkt, sizeof(pkt));
}

bool receiveOK(uint32_t timeout_ms) {
  uint8_t resp[64] = {0};
  uint8_t idx = 0;
  uint32_t start = millis();

  while (millis() - start < timeout_ms && idx < sizeof(resp)) {
    if (FP_SERIAL.available()) resp[idx++] = FP_SERIAL.read();
  }

  // Expect: 0xEF 0x01 .... 0x07 (ACK packet) ... 0x00 (confirm code)
  if (idx >= 12 && resp[0] == 0xEF && resp[1] == 0x01 && resp[6] == 0x07 && resp[9] == 0x00) {
    return true;
  }
  return false;
}

// ---------------- Templates / Index ----------------
int readTemplateCount() {
  clearFpRx();
  send_cmd(CMD_TEMPLATE_NUM);
  uint8_t resp[64] = {0}; uint8_t idx = 0;
  uint32_t start = millis();
  while (millis() - start < 1000 && idx < sizeof(resp)) {
    if (FP_SERIAL.available()) resp[idx++] = FP_SERIAL.read();
  }
  if (idx >= 12 && resp[0]==0xEF && resp[1]==0x01 && resp[6]==0x07 && resp[9]==0x00) {
    lastActivityMs = millis();
    return (int)(((uint16_t)resp[10] << 8) | resp[11]);
  }
  return -1;
}

bool readIndexPage(uint8_t page, uint8_t out32[32]) {
  clearFpRx();
  send_cmd2(CMD_READ_INDEX, page);
  uint8_t resp[128] = {0}; uint8_t idx = 0;
  uint32_t start = millis();
  while (millis() - start < 1000 && idx < sizeof(resp)) {
    if (FP_SERIAL.available()) resp[idx++] = FP_SERIAL.read();
  }
  if (idx >= 44 && resp[0]==0xEF && resp[1]==0x01 && resp[6]==0x07 && resp[9]==0x00) {
    for (uint8_t i=0; i<32; i++) out32[i] = resp[10+i];
    lastActivityMs = millis();
    return true;
  }
  return false;
}

int findNextFreeID() {
  if (g_capacity == 0) g_capacity = 1000;
  uint16_t remaining = g_capacity;
  uint8_t page = 0;
  while (remaining > 0) {
    uint8_t bits[32];
    if (!readIndexPage(page, bits)) {
      // If index read fails, fall back to linear probing while avoiding 0
      for (uint16_t i = page*256; i < page*256 + 256 && i < g_capacity; i++) {
        if (i == 0) continue;        // <-- skip ID 0
        return i;                    // let STORE fail if actually occupied
      }
      return -1;
    }
    for (uint16_t bit = 0; bit < 256 && (page*256 + bit) < g_capacity; bit++) {
      uint16_t id = (uint16_t)(page*256 + bit);
      if (id == 0) continue;         // <-- skip ID 0 so first template is ID=1
      uint8_t byteIdx = bit / 8;
      uint8_t mask    = 1 << (bit % 8);
      bool used = (bits[byteIdx] & mask) != 0;
      if (!used) return (int)id;
    }
    remaining = (remaining > 256) ? (remaining - 256) : 0;
    page++;
  }
  return -1; // full
}

// ---------------- Optional power gate ----------------
#if FP_USE_POWER_GATE
void powerOnSensor() {
  if (FP_POWER_PIN >= 0) {
    digitalWrite(FP_POWER_PIN, HIGH);   // HIGH = ON (adjust if your switch is active-LOW)
    delay(200); // allow module power-up (datasheet-friendly)
  }
  FP_SERIAL.setPins(FP_RX_PIN, FP_TX_PIN);
  FP_SERIAL.begin(FP_BAUD);
  g_fpState = FP_ACTIVE;
  clearFpRx();
  // small probe to sync
  send_cmd(CMD_READ_SYSPARA);
  (void)receiveOK(200);
  lastActivityMs = millis();
}

void powerOffSensor() {
  g_fpState = FP_OFF;
  clearFpRx();
  FP_SERIAL.flush();
  if (FP_POWER_PIN >= 0) {
    digitalWrite(FP_POWER_PIN, LOW);    // LOW = OFF (adjust if needed)
  }
}
#endif
