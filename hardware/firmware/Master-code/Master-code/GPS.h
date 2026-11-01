#ifndef GPS_H
#define GPS_H

#include <TinyGPS++.h>
#include <SoftwareSerial.h>

struct GPSData {
  double latitude;
  double longitude;
  bool valid;
};

void gpsInit(int rxPin, int txPin, unsigned long baudRate);
GPSData getGPSData();

#endif