#include "HTTPClient.h"
#include "ATCommands.h"

extern Uart Serial1;

HTTPClient::HTTPClient(const char* baseUrl) {
  this->baseURL = baseUrl;
}

void HTTPClient::initModem() {
  ATCommandOK("AT+CGDCONT=1,\"IP\",\"move.dataxs.mobi\"\r\n", true);
}

void HTTPClient::startHTTP() {
  ATCommandOK("AT\r\n", true);
  ATCommandOK("ATE0\r\n", true);
  ATCommandOK("AT+HTTPINIT\r\n", true);
  Serial.println("HTTP started successfully");
  delay(1000);
}

void HTTPClient::stopHTTP() {
  ATCommandOK("AT+HTTPTERM\r\n", true);
  Serial.println("HTTP stopped successfully");
}

void HTTPClient::sendPOST(const String& endpoint, const String& jsonData) {
  String fullURL = String(baseURL) + endpoint;

  ATCommandOK("AT+HTTPPARA=\"URL\",\"" + fullURL + "\"\r\n", true);
  delay(100);

  ATCommandOK("AT+HTTPPARA=\"CONTENT\",\"application/json\"\r\n", true);

  String payloadCommand = "AT+HTTPDATA=" + String(jsonData.length()) + ",1000\r\n";
  if (sendBlockingATCommand(payloadCommand, true)) {
    if (ATCommandOK(jsonData, true)) {
      if (ATCommandOK("AT+HTTPACTION=1\r\n", true)) {
        checkIncomingHTTPResponse();
        Serial.println("POST Successful");
      }
    }
  }
}

/**
 * Send a GET request
 * @param endpoint The relative endpoint (e.g. "/get/config")
 */
void HTTPClient::sendGET(const String& endpoint) {
  String fullURL = String(baseURL) + endpoint;

  ATCommandOK("AT+HTTPPARA=\"URL\",\"" + fullURL + "\"\r\n", true);
  delay(1000);

  if (ATCommandOK("AT+HTTPACTION=0\r\n", true)) {
    checkIncomingHTTPResponse();
  }
}