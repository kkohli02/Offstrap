#ifndef BLE_H
#define BLE_H

#include <bluefruit.h>

class BLEManager {
public:
    // Public states accessible from main code
    bool travelMode = false;
    bool lostMode = false;
    bool isBLEConnected = false;

    void begin();
    void update();

private:
    BLEService        offstrapService{"12345678-1234-5678-1234-56789ABCDEF0"};
    BLECharacteristic cmdChar{"12345678-1234-5678-1234-56789ABCDEF1", BLEWrite | BLERead | BLENotify, 256};

    void connect_callback(uint16_t conn_handle);
    void disconnect_callback(uint16_t conn_handle, uint8_t reason);
    void cmd_callback(uint16_t conn_hdl, BLECharacteristic* chr, uint8_t* data, uint16_t len);

    void send_response(uint8_t group, uint8_t cmd, uint8_t status);
    void send_device_status();

    static BLEManager* instance; // Static instance for callbacks
};

#endif