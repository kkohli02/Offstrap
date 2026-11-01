#ifndef FPS_H
#define FPS_H

#include <Arduino.h>
#include <SoftwareSerial.h>

class FingerprintSensor {
  public:
    FingerprintSensor(uint8_t rxPin, uint8_t txPin, uint8_t intPin);

    void begin(uint32_t baud = 57600);
    bool readInfo();
    bool detectFinger(uint16_t timeout_ms = 10000);
    bool registerFinger();
    bool searchFinger();
    bool clearDatabase();

  private:
    SoftwareSerial fpSerial;
    uint8_t intPin;

    // Device constants
    static const uint8_t HEADER_HIGH = 0xEF;
    static const uint8_t HEADER_LOW  = 0x01;
    static const uint32_t DEVICE_ADDRESS = 0xFFFFFFFF;

    // Command codes
    static const uint8_t CMD_GET_IMAGE   = 0x01;
    static const uint8_t CMD_GEN_CHAR    = 0x02;
    static const uint8_t CMD_MATCH       = 0x03;
    static const uint8_t CMD_SEARCH      = 0x04;
    static const uint8_t CMD_REG_MODEL   = 0x05;
    static const uint8_t CMD_STORE_CHAR  = 0x06;
    static const uint8_t CMD_CLEAR_LIB   = 0x0D;
    static const uint8_t CMD_READ_SYSPARA= 0x0F;

    // Template storage
    static const uint16_t TEMPLATE_ID = 1;

    // Internal helpers
    void sendCmd(uint8_t cmd);
    void sendCmd2(uint8_t cmd, uint8_t param1);
    void sendCmd3(uint8_t cmd, uint8_t param1, uint16_t param2);
    void sendCmd4(uint8_t cmd, uint8_t param1, uint16_t param2, uint16_t param3);
    bool receiveResponse(uint16_t waitTime = 200);
};

#endif