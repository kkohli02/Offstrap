# Offstrap | Embedded Firmware

**Smart. Secure. Connected.**

This directory contains the embedded firmware and hardware integration code developed for **Offstrap**, a smart luggage platform designed to combine physical security, wireless connectivity, location tracking, and user interaction in a single connected system.

The firmware is primarily written in **C/C++ using the Arduino framework**, with development targeting the Nordic nRF52840 microcontroller and connected peripheral modules.

## 1. System Overview

Offstrap integrates several hardware subsystems:

| Component | Function |
|---|---|
| nRF52840 MCU | Primary controller and BLE communication |
| Bluetooth Low Energy | Device pairing, proximity detection and wireless communication |
| GPS Module | Satellite-based location acquisition |
| GSM/LTE Module | Cellular communication and remote connectivity |
| Fingerprint Sensor | Biometric authentication |
| E-paper Display | Device information, status and visual interface |
| Electronic Lock | Hardware locking and unlocking |
| Buzzer | Audible alerts and proximity-based identification |

The firmware explores coordination between these subsystems, including device authentication, power management, location tracking and remote communication.

## 2. Firmware Structure

```text
firmware/
├── Master-code/
│   └── Master-code/
│       ├── Master-code.ino
│       ├── BLE.cpp / BLE.h
│       ├── GPS.cpp / GPS.h
│       ├── FPS.cpp / FPS.h
│       ├── EPAPER.cpp / EPAPER.h
│       ├── LOCK.cpp / LOCK.h
│       ├── HTTPClient.cpp / HTTPClient.h
│       └── ATCommands.cpp / ATCommands.h
│
├── GSM/
│   └── main/
│       ├── main.ino
│       ├── ATCommands.cpp / ATCommands.h
│       ├── HTTPClient.cpp / HTTPClient.h
│       └── supporting display assets
│
├── GPS/
│   └── GPS.ino
│
├── fingerprint/
│   └── fingerprint.ino
│
├── Epaper-GD/
│   └── Epaper-GD.ino
│
├── epaper-lost/
│   └── epaper-lost.ino
│
└── gsm_sleep/
    └── gsm_sleep.ino
```

The `Master-code` directory contains a modular integration prototype, while `GSM/main` contains a more extensive application sketch incorporating BLE pairing, fingerprint handling, e-paper functionality, device identification and cellular communication logic.

The remaining directories contain subsystem-specific implementations and development experiments.

## 3. Core Firmware Modules

### Bluetooth Low Energy

The BLE implementation supports device discovery, pairing and connection management.

The extended firmware also includes OTP-gated pairing logic, persistent device ownership state, proximity monitoring using RSSI, and alarm control.

### Fingerprint Authentication

The fingerprint subsystem communicates with a biometric sensor through a serial interface.

Its implementation includes sensor communication, authentication handling and power-control routines intended to reduce unnecessary peripheral activity.

### GPS and Cellular Communication

GPS functionality handles location acquisition through a serial-connected receiver.

The cellular subsystem uses AT commands for modem communication and includes HTTP request handling for exchanging data with remote services.

The code also contains experiments related to modem sleep and power management.

### E-paper Display

The display subsystem manages an e-paper interface, including text rendering, device information and status screens.

Additional sketches explore dedicated display states, including lost-mode presentation.

### Electronic Lock and Buzzer

The lock module provides a software interface for controlling the electronic locking mechanism.

The buzzer provides audible feedback for device identification and alert scenarios.

## 4. Development Environment

**Language:** C/C++  
**Framework:** Arduino  
**Primary MCU:** Nordic nRF52840  
**Communication:** BLE, UART, cellular modem AT commands and HTTP

The source references libraries and platform components including:

- Adafruit Bluefruit nRF52
- Adafruit TinyUSB
- Adafruit LittleFS / InternalFileSystem
- GxEPD2
- Adafruit GFX
- TinyGPS++
- SoftwareSerial
- QR-code rendering libraries

Library requirements vary between sketches. Compatible board support packages, driver versions, pin mappings and display configurations must be selected for the target hardware.

## 5. Building and Flashing

1. Install Arduino IDE and the appropriate board support package for the target microcontroller.
2. Install the libraries required by the chosen sketch.
3. Open the relevant `.ino` file.
4. Connect the corresponding hardware and verify UART, GPIO and power connections.
5. Configure hardware-specific parameters and local service credentials.
6. Select the correct development board and upload interface.
7. Compile and flash the firmware.
8. Use the serial monitor to inspect diagnostic output and verify peripheral communication.

**Note:** These sketches represent multiple stages of development. They are not guaranteed to compile or operate together without additional configuration and validation.

## 6. Configuration and Security

Authentication credentials, private service endpoints and device-specific configuration values are intentionally excluded or replaced with placeholders in the public source.

Before deployment:

- Supply valid credentials through a private configuration mechanism.
- Never commit passwords, API keys or private certificates.
- Validate BLE pairing and device authorization.
- Use encrypted network communication where supported.
- Remove sensitive information from diagnostic logs.
- Verify lock behavior and hardware fail-safe conditions.

Public examples are intended to illustrate development architecture, not to provide a preconfigured deployment environment.

## 7. Development Status

This repository documents Offstrap's embedded firmware development, subsystem experiments and hardware integration efforts.

Individual features may be implemented, partially integrated or under testing. Inclusion of a module does not imply production validation.

The code is published for technical documentation, development transparency and reference purposes.

## 8. Project Repository

For the broader Offstrap project, including additional hardware and software components, visit the [main Offstrap repository](https://github.com/kkohli02/Offstrap).

---

**Offstrap**  
*Smart. Secure. Connected.*
