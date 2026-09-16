# OffStrap - Smart Luggage, Built From Scratch

I started OffStrap as a registered company, not a class project or a side hackathon build. It's a smart backpack with GPS and cellular tracking, fingerprint security, an always-on E-Paper display, and a 10,000mAh battery bank built in. I designed it, built it, manufactured it, and sold it myself.

Storefront (archived, waitlist only): [shop.offstrap.com](https://shop.offstrap.com/)

**Status: Discontinued.** I explain why further down. The engineering and business work still stand on their own.

## Why I'm including this repo

I'm putting this in my masters application to show the full arc of building a hardware startup, not just an idea or a weekend build. I took this from a concept through prototyping, a custom PCB, real advertising, a 500 person waitlist, a bulk B2B order, and eventually a decision to shut it down. I started with a cofounder who left early on. From that point, the firmware, the app, the hardware iteration, and the business side were all on me.

## The problem I was trying to solve

A normal backpack gives you no protection if someone opens it, steals it, or you just lose track of it. Tracker tags exist, but they bolt location onto a bag as an afterthought. They don't give you physical authentication or a real security layer built into the bag itself.

My premise with OffStrap: make the backpack itself an authenticated, connected device, not an accessory with a tracker taped to it.

## What OffStrap does

- GPS and GSM/LTE tracking through a SIMCom A7670G-LABC module, so the bag can be located even without the owner's phone nearby
- Fingerprint based locking (ZW0642 sensor), so the bag only opens for the owner
- An E-Paper display that keeps showing status, lost mode info, or an OTP even when the internal battery is dead
- A 10,000mAh power bank built in, which also charges your phone
- BLE and cellular connectivity together, BLE for nearby interaction and cellular for when the bag is out of range
- A companion app for provisioning, live status, tracking, lost mode, and account management

```
                     OFFSTRAP
                        |
         ------------------------------
         |                             |
     SECURITY                    CONNECTIVITY                INTERFACE
         |                             |                          |
  Fingerprint auth              BLE / LTE / GNSS            E-Paper display
  Lock state                    App link                    Alarm / status
  Tamper detection
```

## How this repo is organized

- **[`app/`](app/)** has the React Native companion app: screens, BLE logic, cloud sync, and screenshots. Details in [`app/README.md`](app/README.md).
- **[`hardware/`](hardware/)** has the firmware and PCB documentation, prototype and PCB photos, and the device simulator. The Arduino source will go in `hardware/firmware/` once it's ready. Details in [`hardware/README.md`](hardware/README.md).

## A glimpse

<table>
<tr>
<td><img src="app/screenshots/dashboard-live-tracking.jpg" width="180"/></td>
<td><img src="hardware/photos/custom-pcb-populated.jpg" width="180"/></td>
<td><img src="hardware/photos/breadboard-prototype.jpg" width="180"/></td>
</tr>
<tr>
<td align="center">App dashboard</td>
<td align="center">Custom PCB</td>
<td align="center">Early prototype</td>
</tr>
</table>

## How I approached the engineering

A few things I kept coming back to while building this:

1. **Security should come from physical events, not software triggers.** Fingerprint checks, tamper detection, and lock state all had to originate from something physically happening, not a BLE command deciding to run a verification on its own.
2. **Anything power hungry should sleep by default.** The fingerprint sensor, the display, the cellular modem, and the GNSS module all needed to stay off unless they were actually doing something.
3. **The exact component I bought is the source of truth.** Cellular modem variants matter a lot. I built the A7670G-LABC implementation from its actual documentation rather than assuming a similar sounding module would behave the same way.
4. **Hardware and firmware have to be designed together.** A firmware interface only works if the electrical interface underneath it is actually right.
5. **A prototype assumption shouldn't quietly become a production requirement.** I tried to track what was confirmed, what was implemented, what was experimental, and what was still TBD at every stage, instead of letting early shortcuts harden into the final design.

## How the prototype evolved

```
Concept -> Breadboard prototype -> Functional prototype -> Mobile app -> Custom PCB -> Commercialization
```

1. **Concept.** Backpack, BLE, fingerprint, display, and tracking as one system, not separate parts glued together.
2. **Breadboard prototype.** I used individual dev boards and modules to validate the MCU, BLE, fingerprint interaction, display, and alarm separately before combining anything.
3. **Functional prototype.** I integrated those subsystems into one working device: authentication, display behavior, BLE communication, and device state all working together.
4. **Mobile app.** I built a dedicated React Native app for onboarding, device discovery, control, monitoring, security management, and tracking.
5. **Custom PCB.** I moved the hardware from a stack of dev boards to one integrated board with an nRF52840 class MCU, the A7670G-LABC LTE module, and a u-blox NEO-M8N GNSS chip.
6. **Commercialization.** I registered the company, got GST registration, ran paid ads, built a waitlist, and had bulk order conversations.

## The business side of this (it was a real company)

- I registered the business legally and got it GST registered under the OffStrap brand. I have the registration and GST documents, I just haven't included them here since they're not necessary to prove the point and I'd rather keep them private.
- I ran paid advertising on Meta (Facebook and Instagram) to test real demand.
- I built a waitlist of around 500 people who said they'd buy at 9,999 rupees.
- I had a bulk order conversation with a company for 350 to 400 units, which came directly out of the product demo and the waitlist traction.
- The storefront is still up at [shop.offstrap.com](https://shop.offstrap.com/), though it's showing a waitlist page now instead of active checkout.

Those conversations moved me from "can I build this" to "will people actually pay for this, can I manufacture it, can I price it right, can I legally ship it."

## What I actually did

I started this with a technical cofounder who left the project early. After that, I was responsible for everything:

- Firmware and embedded systems: the nRF52840 BLE stack, the A7670 GSM/LTE integration, GNSS, and low power design
- The React Native companion app: provisioning, BLE, cloud sync, real time state
- Hardware prototyping, iteration, custom PCB design, and testing
- The business side: registration, sourcing manufacturing, advertising, sales, and the bulk order negotiation

## Why I discontinued it

By the time I stopped, I had a working prototype, a custom PCB, a waitlist, and a bulk order conversation in progress. What ended it wasn't the technology or a lack of interest. It was a regulatory change around how power banks can be transported and shipped. The built in 10,000mAh battery was a core part of what made OffStrap useful, so that change made it much harder to legally and practically ship, carry, and sell the product the way I'd designed it.

I decided it made more sense to stop than to keep building around a product that had become significantly harder to actually get to customers.

```
Idea -> Prototype -> Functional hardware -> Mobile app -> Custom PCB
     -> Market testing -> Customer interest -> Commercial evaluation -> Discontinued
```

## What I took away from this

Making the product actually work turned out to be the easier part. The harder questions were:

- Engineering: does the system work reliably?
- Power: can it run long enough to be useful?
- Manufacturing: can I turn a prototype into something repeatable?
- Economics: can I actually build and sell this at a price people will pay?
- Reliability: what happens when connectivity drops?
- Security: what happens when authentication fails?
- Regulation: can I legally deploy this where I want to sell it?
- Market: do people actually want this, at this price, in this form?

I went from thinking "I need to build something technically interesting" to "I need to build something that survives contact with the real world." The regulation question is what actually ended OffStrap, and it's the one thing good engineering alone couldn't have fixed after the fact.

## A note on this repo

This is a cleaned copy of my working codebase. I removed build artifacts, CocoaPods dependencies, and Ruby vendor bundles since none of that is actual source code and all of it can be regenerated. I also stripped out API keys, credentials, and personal contact details that were in the original files. I didn't change any of the actual app or firmware logic.
