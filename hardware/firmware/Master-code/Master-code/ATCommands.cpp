#include "ATCommands.h"

extern Uart Serial1;  // Use external UART (on nRF52840: pin 0 & 1)

bool matchString(String m1, const char* m2) {
  return m1.indexOf(m2) != -1;
}

String ReadString() {
  String str = "";
  if (Serial1.available() > 0) {
    str = Serial1.readStringUntil('\n');
    str.trim(); // remove leading/trailing whitespace
    Serial.print("C "); Serial.println(str);
  }
  return str;
}

bool ATCommandOK(String cmd, bool extendTime) {
  Serial.print("M "); Serial.println(cmd);
  Serial1.print(cmd);  // doesn't auto-append \r

  unsigned long t = millis();
  unsigned long t2 = extendTime ? 8000L : 6000L;
  String str;

  while (millis() - t < t2) {
    if (Serial1.available()) {
      str = ReadString();
      if (matchString(str, "OK"))      return true;
      if (matchString(str, "ERROR"))   return false;
    }
  }

  Serial.println("timeout (ATCommandOK)");
  return false;
}

bool sendBlockingATCommand(String cmd, bool extendTime) {
  Serial.print("M "); Serial.println(cmd);
  Serial1.print(cmd);

  unsigned long t = millis();
  unsigned long t2 = extendTime ? 6000L : 4000L;
  String str;

  while (millis() - t < t2) {
    if (Serial1.available()) {
      str = ReadString();
      if (matchString(str, "DOWNLOAD")) return true;
      if (matchString(str, "ERROR"))    return false;
    }
  }

  Serial.println("timeout (sendBlockingATCommand)");
  return false;
}

void checkIncomingHTTPResponse() {
  String response;
  while (true) {
    response = ReadString();
    if (response.startsWith("+HTTPACTION")) {
      break;
    }
  }
}
