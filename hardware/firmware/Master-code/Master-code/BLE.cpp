#include "BLE.h"

// Static instance
BLEManager* BLEManager::instance = nullptr;

void BLEManager::begin() {
    instance = this;

    Bluefruit.begin();
    Bluefruit.setTxPower(4);
    Bluefruit.setName("OffStrap");

    // Start the service
    offstrapService.begin();

    // Setup command characteristic
    cmdChar.setProperties(CHR_PROPS_READ | CHR_PROPS_WRITE | CHR_PROPS_NOTIFY);
    cmdChar.setPermission(SECMODE_OPEN, SECMODE_OPEN);
    cmdChar.setMaxLen(256);
    cmdChar.setWriteCallback([](uint16_t conn_hdl, BLECharacteristic* chr, uint8_t* data, uint16_t len) {
        instance->cmd_callback(conn_hdl, chr, data, len);
    });
    cmdChar.begin();

    // Advertising
    Bluefruit.Advertising.addService(offstrapService);
    Bluefruit.Advertising.addName();

    // Connection callbacks
    Bluefruit.Periph.setConnectCallback([](uint16_t conn_handle) {
        instance->connect_callback(conn_handle);
    });
    Bluefruit.Periph.setDisconnectCallback([](uint16_t conn_handle, uint8_t reason) {
        instance->disconnect_callback(conn_handle, reason);
    });

    Bluefruit.Advertising.start();
    Serial.println("📡 BLE Advertising started...");
}

void BLEManager::update() {
    // Keep BLE advertising if disconnected (auto-reconnect)
    if (!isBLEConnected && !Bluefruit.Advertising.isRunning()) {
        Serial.println("🔄 Restarting advertising...");
        Bluefruit.Advertising.start();
    }
}

void BLEManager::connect_callback(uint16_t conn_handle) {
    isBLEConnected = true;
    Serial.println("🔌 Connected!");
}

void BLEManager::disconnect_callback(uint16_t conn_handle, uint8_t reason) {
    isBLEConnected = false;
    Serial.print("❎ Disconnected, reason: 0x");
    Serial.println(reason, HEX);
}

void BLEManager::cmd_callback(uint16_t conn_hdl, BLECharacteristic* chr, uint8_t* data, uint16_t len) {
    Serial.printf("\n📩 Received %d bytes\n", len);

    if (len < 8 || data[0] != 0xCD) {
        Serial.println("❌ Invalid packet");
        return;
    }

    uint8_t group = data[3];
    uint8_t cmd = data[4];
    uint8_t version = data[5];
    uint16_t payload_len = data[6] | (data[7] << 8);

    Serial.printf("Group: 0x%X  Cmd: 0x%X  Version: %d  PayloadLen: %d\n",
                  group, cmd, version, payload_len);

    bool sendSuccess = false;

    switch (group) {
        case 0x10: // Security (Unlock)
            Serial.println("🔓 Unlock Command");
            sendSuccess = true;
            break;

        case 0x20: // Biometric
            Serial.println("🖐 Biometric Operation");
            sendSuccess = true;
            break;

        case 0x30: // E-paper
            Serial.println("🖥 E-paper Display Operation");
            sendSuccess = true;
            break;

        case 0x40: // Find Device
            Serial.println("📍 Find Device Operation");

            if (cmd == 0x03) {
                lostMode = !lostMode;
                Serial.printf("   Lost mode is now: %s\n", lostMode ? "ON" : "OFF");
            }

            if (cmd == 0x04) {
                travelMode = !travelMode;
                Serial.printf("   Travel mode is now: %s\n", travelMode ? "ON" : "OFF");
            }

            sendSuccess = (cmd != 0x01);
            break;

        default:
            Serial.println("⚠️ Unsupported command group");
    }

    if (sendSuccess) {
        send_response(group, cmd | 0x80, 0x00);
        send_device_status();
    }
}

void BLEManager::send_response(uint8_t group, uint8_t cmd, uint8_t status) {
    uint8_t response[9] = {
        0xCD, 0x09, 0x00,
        group,
        0x01, // Version
        cmd,
        0x01, 0x00,
        status
    };
    cmdChar.notify(response, sizeof(response));
    Serial.println("📤 Sent response packet");
}

void BLEManager::send_device_status() {
    uint8_t battery = 100;
    uint8_t lat[4] = {0, 0, 0, 0};
    uint8_t lng[4] = {0, 0, 0, 0};

    uint8_t packet[19] = {
        0xCD, 0x13, 0x00,
        0x50, // Device management
        0x01, // Version
        0x01, // Command ID
        0x0C, 0x00, // Payload length
        battery,
        lat[0], lat[1], lat[2], lat[3],
        lng[0], lng[1], lng[2], lng[3],
        (uint8_t)travelMode,
        (uint8_t)lostMode
    };
    cmdChar.notify(packet, sizeof(packet));
    Serial.println("📤 Sent device status");
}