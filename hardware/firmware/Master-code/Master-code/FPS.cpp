#include "FPS.h"

FingerprintSensor::FingerprintSensor(uint8_t rxPin, uint8_t txPin, uint8_t intPin)
  : fpSerial(rxPin, txPin), intPin(intPin) {}

void FingerprintSensor::begin(uint32_t baud) {
  pinMode(intPin, INPUT_PULLUP);
  fpSerial.begin(baud);
}

bool FingerprintSensor::readInfo() {
  uint8_t response[32];
  uint8_t index = 0;
  uint32_t startTime = millis();

  sendCmd(CMD_READ_SYSPARA);

  while (millis() - startTime < 2000) {
    if (fpSerial.available()) {
      response[index++] = fpSerial.read();
      if (index >= 28) break;
    }
  }

  if (index >= 28 && response[9] == 0x00) {
    Serial.print("Registered fingerprints: ");
    Serial.println((uint16_t)(response[10] << 8) | response[11]);
    return true;
  }
  return false;
}

bool FingerprintSensor::detectFinger(uint16_t timeout_ms) {
  uint32_t start = millis();
  while (digitalRead(intPin) == LOW) {
    if (millis() - start > timeout_ms) return false;
  }
  return true;
}

bool FingerprintSensor::registerFinger() {
  const uint8_t MAX_ATTEMPTS = 3;

  // Step 1 & 2: capture twice
  for (uint8_t bufId = 1; bufId <= 2; bufId++) {
    bool success = false;
    for (uint8_t attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      sendCmd(CMD_GET_IMAGE);
      if (!receiveResponse()) continue;
      sendCmd2(CMD_GEN_CHAR, bufId);
      if (receiveResponse()) { success = true; break; }
    }
    if (!success) return false;
  }

  sendCmd(CMD_REG_MODEL);
  if (!receiveResponse()) return false;

  sendCmd3(CMD_STORE_CHAR, 1, TEMPLATE_ID);
  return receiveResponse();
}

bool FingerprintSensor::searchFinger() {
  sendCmd(CMD_GET_IMAGE);
  if (!receiveResponse()) return false;

  sendCmd2(CMD_GEN_CHAR, 1);
  if (!receiveResponse()) return false;

  sendCmd4(CMD_SEARCH, 1, 1, 1);
  return receiveResponse();
}

bool FingerprintSensor::clearDatabase() {
  sendCmd(CMD_CLEAR_LIB);
  return receiveResponse();
}

// ------------------- Low-level send/receive -------------------
void FingerprintSensor::sendCmd(uint8_t cmd) {
  uint8_t packet[12];
  uint16_t length = 3;
  uint16_t checksum = 1 + length + cmd;

  packet[0]=HEADER_HIGH; packet[1]=HEADER_LOW;
  packet[2]=(DEVICE_ADDRESS>>24)&0xFF; packet[3]=(DEVICE_ADDRESS>>16)&0xFF;
  packet[4]=(DEVICE_ADDRESS>>8)&0xFF;  packet[5]=DEVICE_ADDRESS&0xFF;
  packet[6]=0x01; packet[7]=(length>>8)&0xFF; packet[8]=length&0xFF;
  packet[9]=cmd; packet[10]=(checksum>>8)&0xFF; packet[11]=checksum&0xFF;

  fpSerial.write(packet, sizeof(packet));
}

void FingerprintSensor::sendCmd2(uint8_t cmd, uint8_t param1) {
  uint8_t packet[13];
  uint16_t length = 4;
  uint16_t checksum = 1 + length + cmd + param1;

  packet[0]=HEADER_HIGH; packet[1]=HEADER_LOW;
  packet[2]=(DEVICE_ADDRESS>>24)&0xFF; packet[3]=(DEVICE_ADDRESS>>16)&0xFF;
  packet[4]=(DEVICE_ADDRESS>>8)&0xFF;  packet[5]=DEVICE_ADDRESS&0xFF;
  packet[6]=0x01; packet[7]=(length>>8)&0xFF; packet[8]=length&0xFF;
  packet[9]=cmd; packet[10]=param1; packet[11]=(checksum>>8)&0xFF; packet[12]=checksum&0xFF;

  fpSerial.write(packet, sizeof(packet));
}

void FingerprintSensor::sendCmd3(uint8_t cmd, uint8_t param1, uint16_t param2) {
  uint8_t packet[15];
  uint16_t length = 6;
  uint16_t checksum = 1 + length + cmd + param1 + (param2>>8) + (param2&0xFF);

  packet[0]=HEADER_HIGH; packet[1]=HEADER_LOW;
  packet[2]=(DEVICE_ADDRESS>>24)&0xFF; packet[3]=(DEVICE_ADDRESS>>16)&0xFF;
  packet[4]=(DEVICE_ADDRESS>>8)&0xFF;  packet[5]=DEVICE_ADDRESS&0xFF;
  packet[6]=0x01; packet[7]=(length>>8)&0xFF; packet[8]=length&0xFF;
  packet[9]=cmd; packet[10]=param1; packet[11]=(param2>>8)&0xFF; packet[12]=param2&0xFF;
  packet[13]=(checksum>>8)&0xFF; packet[14]=checksum&0xFF;

  fpSerial.write(packet, sizeof(packet));
}

void FingerprintSensor::sendCmd4(uint8_t cmd, uint8_t param1, uint16_t param2, uint16_t param3) {
  uint8_t packet[17];
  uint16_t length = 8;
  uint16_t checksum = 1 + length + cmd + param1 + (param2>>8) + (param2&0xFF) + (param3>>8) + (param3&0xFF);

  packet[0]=HEADER_HIGH; packet[1]=HEADER_LOW;
  packet[2]=(DEVICE_ADDRESS>>24)&0xFF; packet[3]=(DEVICE_ADDRESS>>16)&0xFF;
  packet[4]=(DEVICE_ADDRESS>>8)&0xFF;  packet[5]=DEVICE_ADDRESS&0xFF;
  packet[6]=0x01; packet[7]=(length>>8)&0xFF; packet[8]=length&0xFF;
  packet[9]=cmd; packet[10]=param1; packet[11]=(param2>>8)&0xFF; packet[12]=param2&0xFF;
  packet[13]=(param3>>8)&0xFF; packet[14]=param3&0xFF;
  packet[15]=(checksum>>8)&0xFF; packet[16]=checksum&0xFF;

  fpSerial.write(packet, sizeof(packet));
}

bool FingerprintSensor::receiveResponse(uint16_t waitTime) {
  uint8_t response[50];
  uint8_t index = 0;
  uint32_t startTime = millis();

  while (millis() - startTime < waitTime) {
    if (fpSerial.available()) {
      response[index++] = fpSerial.read();
    }
  }
  return (index >= 12 && response[9] == 0x00);
}