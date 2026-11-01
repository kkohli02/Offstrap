#include <Arduino.h>
#include <ArduinoJson.h>
#include <Adafruit_TinyUSB.h>
#define DTR_PIN 2

// Serial object for SIM module (use Serial, Serial1, or SoftwareSerial as appropriate)
#define SIM_SERIAL Serial1

void sendAT(const char* cmd, unsigned long timeout = 1000) {
  SIM_SERIAL.println(cmd);
  unsigned long tstart = millis();
  while (millis() - tstart < timeout) {
    if (SIM_SERIAL.available()) {
      String line = SIM_SERIAL.readStringUntil('\n');
      Serial.println("SIM reply: " + line);
    }
  }
}

void setup() {
  Serial.begin(115200);         // For output to monitor
  SIM_SERIAL.begin(115200);       // Adjust to module's baud rate

  pinMode(DTR_PIN, OUTPUT);
  digitalWrite(DTR_PIN, HIGH);  // Module awake by default

  delay(3000);

  Serial.println("Enabling sleep mode on SIM module...");
  sendAT("AT+CSCLK=1");         // Allow sleep controlled by DTR
  delay(1000);

  Serial.println("Setup complete. Type S to sleep, W to wake.");
}

void loop() {
  // For demonstration: send S in Serial monitor to sleep, W to wake
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'S' || c == 's') {
      Serial.println("[Go to SLEEP] Setting DTR LOW");
      //digitalWrite(DTR_PIN, LOW);          // DTR low, module sleeps when idle
      sendAT("AT+CSCLK=2");  
      delay(1500); // Allow time to enter sleep
    }
    if (c == 'W' || c == 'w') {
      Serial.println("[Wake up] Setting DTR HIGH");
      //digitalWrite(DTR_PIN, HIGH);    
      sendAT("AT");     
      delay(250);  // DTR high, module awake
      sendAT("AT");       
      delay(250);  // Settling time
      sendAT("AT"); // Wake up with dummy command
    }
  }

  // Echo SIM module replies, for visibility
  if (SIM_SERIAL.available()) {
    String buf = SIM_SERIAL.readStringUntil('\n');
    if (buf.length() > 1) {
      Serial.println("SIM: " + buf);
    }
  }
}
