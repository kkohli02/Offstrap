#include "LOCK.h"

// Store pin internally
static uint8_t lockPin;

void lockInit(uint8_t pin) {
    lockPin = pin;
    pinMode(lockPin, OUTPUT);
    digitalWrite(lockPin, LOW); // Start with lock OFF
}

void unlockBag() {
    Serial.println("Unlocking Bag...");
    digitalWrite(lockPin, HIGH); // Lock ON
    delay(2000);
    digitalWrite(lockPin, LOW);  // Lock OFF after 2 sec
    Serial.println("Bag Unlocked");
}

void lockBag() {
    Serial.println("Locking Bag...");
    digitalWrite(lockPin, LOW); // Lock OFF
}