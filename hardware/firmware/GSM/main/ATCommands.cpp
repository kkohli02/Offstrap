#include "ATCommands.h"

extern Uart Serial1;  // nRF52840 hardware UART

// -------------- Utility -------------- //
bool matchString(String m1, const char* m2) {
  return m1.indexOf(m2) != -1;
}

// -------------- URC Handler -------------- //
void handleURC(const String &line) {
  // Only handle URCs if you truly care
  if (line.startsWith("+CGEV")) {
    // Optional: handle network events
  } else if (line.startsWith("+MSTK")) {
    // Optional: SIM Toolkit event
  } else if (line.startsWith("RING")) {
    // Optional: incoming call
  } else if (line.startsWith("+CMTI")) {
    // Optional: SMS arrival
  }
}

// -------------- Read Line -------------- //
String ReadStringRaw() {
  if (Serial1.available() > 0) {
    String str = Serial1.readStringUntil('\n');
    str.trim();
    return str;
  }
  return "";
}

// -------------- AT Command Helpers -------------- //
bool ATCommandOK(String cmd, bool extendTime) {
  Serial1.print(cmd);  // NOTE: caller must include \r\n

  unsigned long t = millis();
  unsigned long timeout = extendTime ? 8000UL : 6000UL;
  String str;

  while (millis() - t < timeout) {
    str = ReadStringRaw();
    if (str.length() == 0) continue;

    if (matchString(str, "OK"))    return true;
    if (matchString(str, "ERROR")) return false;

    if (str.startsWith("+") || str == "RING") {
      handleURC(str); // Just process, don't print or block
    }
  }
  return false; // timeout
}

bool sendBlockingATCommand(String cmd, bool extendTime) {
  Serial1.print(cmd);

  unsigned long t = millis();
  unsigned long timeout = extendTime ? 6000UL : 4000UL;
  String str;

  while (millis() - t < timeout) {
    str = ReadStringRaw();
    if (str.length() == 0) continue;

    if (matchString(str, "DOWNLOAD")) return true;
    if (matchString(str, "ERROR"))    return false;

    if (str.startsWith("+") || str == "RING") {
      handleURC(str);
    }
  }
  return false; // timeout
}

// -------------- HTTP Response Handling -------------- //
bool checkIncomingHTTPResponse() {
  String response;
  bool httpActionSuccess = false;

  // Wait for +HTTPACTION result (status code 2xx is success)
  unsigned long start = millis();
  while (millis() - start < 30000UL) {
    response = ReadStringRaw();
    if (response.length() == 0) continue;

    if (response.startsWith("+HTTPACTION")) {
      int c1 = response.indexOf(',');
      int c2 = response.indexOf(',', c1 + 1);
      if (c1 != -1 && c2 != -1) {
        int statusCode = response.substring(c1 + 1, c2).toInt();
        if (statusCode >= 200 && statusCode < 300) {
          httpActionSuccess = true;
        }
      }
      break; // Always break after HTTPACTION
    }

    if (response.startsWith("+") || response == "RING") {
      handleURC(response);
    }
  }

  if (!httpActionSuccess) return false;

  // Read HTTP body (ignore headers, just get payload)
  Serial1.print("AT+HTTPREAD\r\n");
  unsigned long start2 = millis();
  bool payloadStarted = false;
  bool gotPayload = false;
  String payload = "";

  while (millis() - start2 < 10000UL) {
    response = ReadStringRaw();
    if (response.length() == 0) continue;

    if (response.startsWith("+HTTPREAD:")) {
      payloadStarted = true;
      continue;
    }

    if (response == "OK") break;

    if (payloadStarted && response != "OK") {
      payload = response;
      gotPayload = true;
      // Only keep first payload or append if expecting multiline (adjust as needed)
      break;  // If you want to keep reading, remove this break
    }
  }

  // Optionally: Do something with payload here.
  // e.g., store to a variable or callback.

  return gotPayload;
}
