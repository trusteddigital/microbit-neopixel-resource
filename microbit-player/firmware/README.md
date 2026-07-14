# Custom CODAL firmware (NeoPixel + Bluetooth)

MakeCode **cannot** enable NeoPixel and Bluetooth together. This folder is a
CODAL C++ program for **micro:bit V2** that does both:

- **PWM NeoPixels** (`HARDWARE_NEOPIXEL`) — SoftDevice-safe, no IRQ lockout
- **BLE UART** — open link (no pairing), for the web designer
- **Flash persistence** — last animation reloads on every power-on

## Build the hex

### Option A — GitHub Actions (recommended)

Push changes under `microbit-player/firmware/` (or run the workflow manually).
Download the `neopixel-bluetooth-player` artifact → save as
`vendor/neopixel-bluetooth-player.hex`.

### Option B — Local (Linux / WSL / macOS)

Needs: Git, CMake, Python 3, [GNU Arm Embedded Toolchain](https://developer.arm.com/downloads/-/arm-gnu-toolchain-downloads).

```bash
git clone https://github.com/lancaster-university/microbit-v2-samples.git /tmp/mb-samples
cp microbit-player/firmware/codal.json /tmp/mb-samples/codal.json
rm -rf /tmp/mb-samples/source/*
cp microbit-player/firmware/source/main.cpp /tmp/mb-samples/source/main.cpp
cd /tmp/mb-samples
python3 build.py
cp MICROBIT.hex /path/to/this/repo/vendor/neopixel-bluetooth-player.hex
```

## Flash onto a micro:bit V2

1. Hold the reset button, plug in USB, release after a second (maintenance mode), **or** just drag-and-drop onto the MICROBIT drive.
2. Copy `vendor/neopixel-bluetooth-player.hex` onto the drive.
3. On boot: display shows **H** (empty) or **P** (saved animation loaded).
4. NeoPixel data wire → **P16**.

## Use with the web designer

1. Open `bluetooth.html` in Chrome/Edge.
2. **Connect Bluetooth** → pick the micro:bit (shows **C** when connected).
3. Design frames → **Send over Bluetooth**.
4. Unplug / battery / plug back in → animation still plays.

Do **not** use USB “Update micro:bit” on the Bluetooth page unless you want to
overwrite this player with a MicroPython animation.

## Protocol

| Line | Meaning |
|------|---------|
| `R` | Reset upload buffer → replies `R` |
| `D<hex>` | Append RGB hex to current frame |
| `P` | Commit frame → replies `A` |
| `S` | Save to flash + show frame 0 → replies `K` |

Brightness and 90° rotation are applied in the browser before send.

## Buttons

- Tap **A** / **B** — next / previous frame
- Hold ≥ 0.5 s — play forward / backward at 10 fps
