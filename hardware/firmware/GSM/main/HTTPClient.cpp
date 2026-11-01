#include "HTTPClient.h"
#include "ATCommands.h"

extern Uart Serial1;
String readHTTPBody() {
  String body = "";
  bool payloadStarted = false;
  unsigned long start = millis();
  String line;

  while (millis() - start < 5000) { // up to 5 seconds
    line = ReadString();
    if (line.length() == 0) continue;

    if (line.startsWith("+HTTPREAD:")) {
      payloadStarted = true; // The next lines are body
      continue; // Skip header line
    }
    if (line == "OK") break;
    if (payloadStarted) body += line + "\n";
  }
  body.trim();
  return body;
}

String ReadString() {
  String line = "";
  unsigned long timeout = millis() + 1500;  // 1.5s timeout
  while (millis() < timeout) {
    while (Serial1.available()) {
      char c = Serial1.read();
      if (c == '\n') {
        line.trim();
        return line;
      } else if (c != '\r') {
        line += c;
      }
    }
    yield(); // For platforms where yield() is meaningful; optional
  }
  line.trim();
  return line; // Could be empty if no data received
}

// ------------------ Utility ------------------ //
String sendATCommand(const String &command, int wait = 500) {
  Serial1.print(command);
  Serial1.print("\r\n");
  delay(wait);

  String response = "";
  unsigned long start = millis();
  while (millis() - start < wait + 200) {
    while (Serial1.available()) {
      response += (char)Serial1.read();
    }
  }
  response.trim();
  return response;
}

static String cleanResponse(const String &res, const String &token) {
  String out = res;
  out.replace(token, "");
  out.replace("OK", "");
  out.replace("\r", "");
  out.replace("\n", "");
  out.trim();
  return out;
}

// ------------------ Constructor ------------------ //
HTTPClient::HTTPClient(const char* postUrl, const char* getUrl) {
  postURL = postUrl;
  getURL  = getUrl;
  imei = "";
  iccid = "";
  msisdn = "";
}

// ------------------ Modem Info ------------------ //
static String getIMEI() {
  String res = sendATCommand("AT+GSN", 1000);
  return cleanResponse(res, "");
}

static String getICCID() {
  String res = sendATCommand("AT+CCID", 1000);
  return cleanResponse(res, "+CCID:");
}

static String getMSISDN() {
  String res = sendATCommand("AT+CNUM", 1000);
  int thirdQuote  = res.indexOf("\"", res.indexOf("\"", res.indexOf("\"") + 1) + 1);
  int fourthQuote = res.indexOf("\"", thirdQuote + 1);
  if (thirdQuote != -1 && fourthQuote != -1) {
    return res.substring(thirdQuote + 1, fourthQuote);
  }
  return "";
}

void HTTPClient::initModem() {
  Serial.println("Initializing SIMCOM A7670G...");

  // 1. Basic communication check
  if (!ATCommandOK("AT\r\n", true)) {
    Serial.println("❌ No response from module");
    return;
  }
  Serial.println("✅ Module responded to AT");

  // 2. Turn off command echo for clarity
  ATCommandOK("ATE0\r\n", true);

  // 3. SIM card status check with retries
  bool simReady = false;
  Serial.println("Checking SIM status...");
  for (int i = 0; i < 10; ++i) {
    Serial1.print("AT+CPIN?\r\n");
    delay(300);
    String resp = ReadString();
    if (resp.indexOf("+CPIN: READY") != -1) {
      simReady = true;
      break;
    } else if (resp.indexOf("+CPIN: SIM PIN") != -1) {
      Serial.println("❌ SIM requires PIN unlock (not handled here)!");
      return;
    }
    delay(700);  // Wait a bit before trying again
  }
  if (!simReady) {
    Serial.println("❌ SIM not ready or missing");
    return;
  }
  Serial.println("✅ SIM ready");

  // 4. Wait for network registration: GSM/LTE registration (CEREG)
  bool reg_ok = false;
  Serial.println("Waiting for LTE network registration...");
  for (int attempts = 0; attempts < 10; ++attempts) {
    Serial1.print("AT+CEREG?\r\n"); // LTE registration
    delay(500);
    String resp = ReadString();
    if (resp.indexOf("+CEREG:") != -1) {
      int stat = resp.charAt(resp.lastIndexOf(',') + 1) - '0';
      // 1: home, 5: roaming (optionally accept 7 for EPS-only)
      if (stat == 1 || stat == 5) {
        reg_ok = true;
        break;
      }
    }
    delay(1000);
  }
  if (!reg_ok) {
    Serial.println("❌ Not registered on network");
    return;
  }
  Serial.println("✅ Registered on network");

  // 5. Attach to packet domain (PDP) and set APN
  const char* apn = "move.dataxs.mobi";
  if (!ATCommandOK("AT+CGDCONT=1,\"IP\",\"" + String(apn) + "\"\r\n", true)) {
    Serial.println("❌ Failed to set APN");
    return;
  }
  Serial.println("✅ APN set: " + String(apn));

  if (!ATCommandOK("AT+CGATT=1\r\n", true)) {
    Serial.println("❌ Failed to attach to packet domain");
    return;
  }
  Serial.println("✅ Packet domain attached");

  // 6. Query and print module info
  imei   = getIMEI();    // AT+GSN or AT+CGSN
  iccid  = getICCID();   // AT+CCID
  msisdn = getMSISDN();  // AT+CNUM

  Serial.println("IMEI: "  + (imei.length() ? imei : "N/A"));
  Serial.println("ICCID: " + (iccid.length() ? iccid : "N/A"));
  Serial.println("MSISDN: "+ (msisdn.length() ? msisdn : "N/A"));
  Serial.println("✅ SIMCOM A7670G initialization complete.");
}



// ------------------ HTTP Lifecycle ------------------ //
bool HTTPClient::startHTTP() {
  if (!ATCommandOK("AT\r\n", true)) return false;
  ATCommandOK("ATE0\r\n", true);   // disable echo
  return ATCommandOK("AT+HTTPINIT\r\n", true);
}

bool HTTPClient::stopHTTP() {
  return ATCommandOK("AT+HTTPTERM\r\n", true);
}

// ------------------ HTTP POST ------------------ //
bool HTTPClient::sendJSON(const String &endpoint, const String &jsonData) {
  String fullUrl = String(postURL) + endpoint;

  // Set URL
  if (!ATCommandOK("AT+HTTPPARA=\"URL\",\"" + fullUrl + "\"\r\n", true)) return false;
  // Set Content-Type
  if (!ATCommandOK("AT+HTTPPARA=\"CONTENT\",\"application/json\"\r\n", true)) return false;

  // Prepare payload
  String payloadCommand = "AT+HTTPDATA=" + String(jsonData.length()) + ",5000\r\n";
  if (!sendBlockingATCommand(payloadCommand, true)) return false;

  // Send actual JSON
  if (!ATCommandOK(jsonData + "\r\n", true)) return false;

  // Trigger POST
  if (!ATCommandOK("AT+HTTPACTION=1\r\n", true)) return false;

  // ---- Wait for HTTPACTION URC ---- //
  String resp;
  int httpStatus = -1, dataLen = 0;
  unsigned long start = millis();

  while (millis() - start < 30000) {
    resp = ReadString();
    if (resp.length() == 0) continue;

    if (resp.startsWith("+HTTPACTION:")) {
      int first  = resp.indexOf(',');
      int second = resp.indexOf(',', first + 1);
      httpStatus = resp.substring(first + 1, second).toInt();
      dataLen    = resp.substring(second + 1).toInt();
      break;
    }
  }

  // If no status code or error
  if (httpStatus < 200 || httpStatus >= 300) {
    Serial.print("❌ POST failed. Status: ");
    Serial.println(httpStatus);
    return false;
  }

  // ---- If success, read body ---- //
  String httpReadCmd = "AT+HTTPREAD=0," + String(dataLen) + "\r\n";
  if (!ATCommandOK(httpReadCmd, true)) return false;

  String body = readHTTPBody();
  Serial.println("✅ POST Success, Response Body:\n" + body);

  return true;
}

// ------------------ HTTP GET ------------------ //
bool HTTPClient::getHTTP(const String &endpoint) {
  String fullUrl = String(getURL) + endpoint;   // base + endpoint

  if (!ATCommandOK("AT+HTTPPARA=\"URL\",\"" + fullUrl + "\"\r\n", true)) return false;
  if (!ATCommandOK("AT+HTTPACTION=0\r\n", true)) return false;

  // Wait for result
  String resp;
  unsigned long start = millis();
  int httpStatus = -1, dataLen = 0;

  while (millis() - start < 30000) {
    resp = ReadString();
    if (resp.startsWith("+HTTPACTION")) {
      int first = resp.indexOf(',');
      int second = resp.indexOf(',', first + 1);
      httpStatus = resp.substring(first + 1, second).toInt();
      dataLen    = resp.substring(second + 1).toInt();
      break;
    }
  }

  if (httpStatus < 200 || httpStatus >= 300) return false;

  delay(300);
  String httpReadCmd = "AT+HTTPREAD=0," + String(dataLen) + "\r\n";
  if (!ATCommandOK(httpReadCmd, true)) return false;

  // Read and print response body
  String body = readHTTPBody();
  Serial.println("HTTP GET Body:\n" + body);
  return true;
}
