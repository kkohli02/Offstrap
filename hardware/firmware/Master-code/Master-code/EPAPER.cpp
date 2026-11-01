#include "EPAPER.h"

// Global pointer to display
static GxEPD2_BW<GxEPD2_290_GDEY029T71H, GxEPD2_290_GDEY029T71H::HEIGHT>* display;

// Text constants
const char MSG_HEADING[]  = "I'm Lost! Contact..";
const char MSG_TAGLINE[]  = "Smart. Secure. Connected.";
const char MSG_BRAND[]    = "OFFSTRAP";

// Helper: center text
static void centerText(const char* text, int y) {
    int16_t x1, y1;
    uint16_t w, h;
    display->getTextBounds(text, 0, y, &x1, &y1, &w, &h);
    int16_t x = (display->width() - w) / 2;
    display->setCursor(x, y);
    display->print(text);
}

// Initialize display with given pins
void displayInit(int cs, int dc, int rst, int busy) {
    static GxEPD2_BW<GxEPD2_290_GDEY029T71H, GxEPD2_290_GDEY029T71H::HEIGHT> disp(
        GxEPD2_290_GDEY029T71H(cs, dc, rst, busy)
    );
    display = &disp;
    display->init(115200, true, 2, false);
    display->setRotation(1); // Landscape mode
}

// Brand screen
void displayBrandScreen(bool blackOnWhite) {
    display->setFullWindow();
    display->firstPage();
    do {
        display->fillScreen(blackOnWhite ? GxEPD_WHITE : GxEPD_BLACK);
        display->setTextColor(blackOnWhite ? GxEPD_BLACK : GxEPD_WHITE);

        display->setFont(&MontserratAlt1_Bold33pt7b);

        int16_t x1, y1;
        uint16_t w, h;
        display->getTextBounds(MSG_BRAND, 0, 0, &x1, &y1, &w, &h);
        int16_t x = (display->width() - w) / 2;
        int16_t y = (display->height() + h) / 2;

        display->setCursor(x, y);
        display->print(MSG_BRAND);
    } while (display->nextPage());
}

// Lost screen
void displayLostScreen(const char* name, const char* phone, bool blackOnWhite) {
    display->setFullWindow();
    display->firstPage();
    do {
        display->fillScreen(blackOnWhite ? GxEPD_WHITE : GxEPD_BLACK);
        display->setTextColor(blackOnWhite ? GxEPD_BLACK : GxEPD_WHITE);

        // Layout
        const int HEADER_Y  = 28;
        const int NAME_Y    = 65;
        const int PHONE_Y   = 100;
        const int BRAND_Y   = 140;
        const int TAGLINE_Y = 160;

        // Heading
        display->setFont(&FreeSansBold12pt7b);
        centerText(MSG_HEADING, HEADER_Y);

        // Name
        display->setFont(&FreeSansBold18pt7b);
        centerText(name, NAME_Y);

        // Phone
        display->setFont(&FreeSansBold12pt7b);
        centerText(phone, PHONE_Y);

        // Brand
        display->setFont(&MontserratAlt1_Bold18pt7b);
        centerText(MSG_BRAND, BRAND_Y);

        // Tagline
        display->setFont(&FreeSansBold9pt7b);
        centerText(MSG_TAGLINE, TAGLINE_Y);
    } while (display->nextPage());
}