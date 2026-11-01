#include <SPI.h>
#include <GxEPD2_BW.h>

#define PIN_EPD_BUSY  A2
#define PIN_EPD_RST   A3
#define PIN_EPD_DC    A4
#define PIN_EPD_CS    A5

GxEPD2_BW<GxEPD2_290_T94, GxEPD2_290_T94::HEIGHT> display(
  GxEPD2_290_T94(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY)
);

static void fullFill(uint16_t color) {
  display.setRotation(1);
  display.setFullWindow();
  display.firstPage();
  do { display.fillScreen(color); } while (display.nextPage());
}

void setup() {
  Serial.begin(115200);
  delay(200);
  display.init(115200, true, 2, true);

  fullFill(GxEPD_BLACK);
  delay(500);
  fullFill(GxEPD_WHITE);
  delay(300);
  fullFill(GxEPD_WHITE);

  display.hibernate();
}

void loop() {}
