#ifndef AT_COMMANDS_H
#define AT_COMMANDS_H

#include <Arduino.h>

// Declare AT command helper functions
bool ATCommandOK(String cmd, bool extendTime);
bool sendBlockingATCommand(String cmd, bool extendTime);
String ReadString();
bool matchString(String response, const char* match);
void checkIncomingHTTPResponse();

#endif
