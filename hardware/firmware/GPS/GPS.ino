#include <Arduino.h>
#include <Adafruit_TinyUSB.h>

#define SIM Serial1

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  // If using pins D0 (RX) and D1 (TX), this is not needed.
  // Uncomment if you wired differently:
  // SIM.setPins(A0, A1); // Feather RX,TX pins

  SIM.begin(115200);
  delay(3000);

  Serial.println("\nSending AT test...");
  SIM.println("AT");
}

void loop() {
  while (SIM.available()) Serial.write(SIM.read());
  while (Serial.available()) SIM.write(Serial.read());
}
