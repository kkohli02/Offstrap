#ifndef EPAPER_H
#define EPAPER_H

#include <Arduino.h>
#include <GxEPD2_BW.h>
#include <GxEPD2_4C.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/MontserratAlt1_Bold18pt7b.h>
#include <Fonts/MontserratAlt1_Bold33pt7b.h>

// Constants
extern const char MSG_HEADING[];
extern const char MSG_TAGLINE[];
extern const char MSG_BRAND[];

// Function Prototypes
void displayInit(int cs, int dc, int rst, int busy);
void displayBrandScreen(bool blackOnWhite);
void displayLostScreen(const char* name, const char* phone, bool blackOnWhite);

#endif