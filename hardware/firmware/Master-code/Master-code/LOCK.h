#ifndef LOCK_H
#define LOCK_H

#include <Arduino.h>

void lockInit(uint8_t pin);
void unlockBag();
void lockBag();

#endif