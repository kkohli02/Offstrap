#ifndef HTTPCLIENT_H
#define HTTPCLIENT_H

#include <Arduino.h>

class HTTPClient {
  public:
    HTTPClient(const char* postUrl, const char* getUrl);

    void initModem();
    void startHTTP();
    void stopHTTP();
    void sendJSON(String jsonData);
    void getHTTP();

  private:
    const char* postURL;
    const char* getURL;
};

#endif