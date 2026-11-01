#include "GPS.h"
#include "EPAPER.h"
#include "LOCK.h"
#include "BLE.h"
#include "HTTPClient.h"

//gps
#define GPS_RX 22
#define GPS_TX 21
#define GPS_BAUD 9600

//epaper
#define EPD_CS   37
#define EPD_DC   38
#define EPD_RST  39
#define EPD_BUSY 40

//LOCK
#define LOCK_PIN 40  

//FPS
#define FP_RX_PIN   15
#define FP_TX_PIN   14
#define FP_INT_PIN  16


BLEManager ble;
HTTPClient http("http-broker.vercel.app"); // for get and post use endpoint /prototype/1
FingerprintSensor finger(FP_RX_PIN, FP_TX_PIN, FP_INT_PIN);



void setup() {
    Serial.begin(115200);
    gpsInit(GPS_RX, GPS_TX, GPS_BAUD);
    displayInit(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY);
    lockInit(LOCK_PIN);
    finger.begin();
  finger.readInfo();    
    ble.begin();
    http.initModem();

}

void loop() {
    ble.update(); // Keep BLE alive (auto-reconnect)

  if (ble.isBLEConnected) {
    if (ble.lostMode) {
      Serial.println("📍 Lost Mode is active!");
    }
    if (ble.travelMode) {
      Serial.println("✈️ Travel Mode is active!");
    }
  }
  else{
    
    http.startHTTP();
    http.sendGET("/prototype/1");
    String jsonBody = "{\"id\":123,\"status\":\"ok\"}";
    http.sendPOST("/prototype/1", jsonBody);

  // Example GET
    

    //write HTTP logic
  }
  

}
