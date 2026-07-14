# micro:bit Bluetooth player

MakeCode **cannot** combine NeoPixel + Bluetooth (they are mutually exclusive).
This project ships **custom CODAL firmware** instead.

## What to flash

| File | Role |
|------|------|
| [`firmware/`](firmware/) | C++ source (PWM NeoPixels + BLE UART + flash save) |
| `vendor/neopixel-bluetooth-player.hex` | Built hex (from GitHub Actions or local build) |

**micro:bit V2 only.** NeoPixel data → **P16**.

## One-time setup

1. Build the hex (see [`firmware/README.md`](firmware/README.md)) or download the CI artifact.
2. Copy `vendor/neopixel-bluetooth-player.hex` onto the micro:bit (USB drag-and-drop).
3. Boot shows **H** (no animation yet) or **P** (saved animation restored).

## Classroom workflow

1. Open `bluetooth.html` in Chrome/Edge.
2. **Connect Bluetooth** → select the micro:bit (display shows **C**).
3. Design → **Send over Bluetooth**.
4. Unplug / battery / plug back in → last animation reloads automatically.
5. Tap **A/B** to step; hold ~0.5s to play at 10 fps.

## Why not MakeCode?

MakeCode removes the NeoPixel / ws2812b extension when you add Bluetooth (and vice versa). Official MicroPython on V2 only exposes BLE for flashing, not app UART. This CODAL build uses the V2 **PWM NeoPixel** driver, which coexists with the SoftDevice.

## Protocol

| Line from web | Meaning |
|---------------|---------|
| `R` | Reset upload buffer |
| `D<hex>` | Append RGB hex to current frame |
| `P` | Finish frame → player replies `A` |
| `S` | Save to flash and play → player replies `K` |
