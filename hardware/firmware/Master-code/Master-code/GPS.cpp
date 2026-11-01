import "GPS.h"
static SoftwareSerial* gpsSerial;
static TinyGPSPlus gps;

void gpsInit(int rxPin, int txPin, unsigned long baudRate) {
  gpsSerial = new SoftwareSerial(rxPin, txPin);
  gpsSerial->begin(baudRate);
}

GPSData getGPSData() {
  GPSData data = {0, 0, false};

  while (gpsSerial->available() > 0) {
    gps.encode(gpsSerial->read());
  }

  if (gps.location.isUpdated()) {
    data.latitude = gps.location.lat();
    data.longitude = gps.location.lng();
    data.valid = true;
  }

  return data;
}