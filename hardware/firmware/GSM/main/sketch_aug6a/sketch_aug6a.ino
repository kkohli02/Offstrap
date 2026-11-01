#include "Adafruit_TinyUSB.h"

void setup() {
  Serial.begin(115200);
  while (!Serial);

  pinMode(0, INPUT_PULLUP);
  Serial1.begin(115200);
  delay(2000);

  Serial.println("Configuring SIMCOM A767C...");

  // Example: Attach + APN + Activate
  sendAT("AT+CGATT=1");
  sendAT("AT+CGDCONT=1,\"IP\",\"move.dataxs.mobi\"");
  sendAT("AT+CGACT=1,1");
}

void loop() {
  if (Serial.available()) Serial1.write(Serial.read());
  if (Serial1.available()) Serial.write(Serial1.read());
}

void sendAT(const char* cmd) {
  Serial.print("> "); Serial.println(cmd);
  Serial1.println(cmd);        // sends CR+LF
  delay(1000);                 // wait for response

  // Read until timeout
  unsigned long start = millis();
  while (millis() - start < 1000) {
    if (Serial1.available()) {
      Serial.write(Serial1.read());
      start = millis();        // reset timeout if data arrives
    }
  }
  Serial.println();
}
