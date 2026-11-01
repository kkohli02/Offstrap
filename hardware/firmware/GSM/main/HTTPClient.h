#ifndef HTTPCLIENT_H
#define HTTPCLIENT_H

#include <Arduino.h>

class HTTPClient {
  public:
    HTTPClient(const char* postUrl, const char* getUrl);

    void initModem();       // initialize modem once
    bool startHTTP();       // return true if started successfully
    bool stopHTTP();        // return true if stopped successfully
    bool sendJSON(const String &endpoint,const String& jsonData);  // POST request -> true on success
    bool getHTTP(const String &endpoint);         // GET request -> true on success
    String imei;
    String iccid;
    String msisdn;
    

  private:
    const char* postURL;
    const char* getURL;
};

#endif