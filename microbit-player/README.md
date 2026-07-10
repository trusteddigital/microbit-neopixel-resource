# micro:bit Bluetooth player

Bluetooth cannot flash MicroPython. This **MakeCode player** runs on the micro:bit
instead. Flash it **once** via MakeCode; then use the web designer’s **Send over
Bluetooth** to upload animations.

**micro:bit V2 only.**

## Setup (do this order exactly)

### 1. New MakeCode project

Open [makecode.microbit.org](https://makecode.microbit.org).

Check the board picker (bottom-right) says **V2**, not V1.

### 2. Add extensions **before** pasting code

| Step | Action |
|------|--------|
| a | **Extensions** → search **`neopixel`** → add **neopixel** (Microsoft) |
| b | **Extensions** → search **`bluetooth`** → add **Bluetooth** |

You should see **NeoPixel** and **Bluetooth** drawers in the toolbox.  
If you paste the code first, MakeCode shows *“Cannot find name neopixel”* — that’s normal until the extensions are added.

### 3. Bluetooth project settings

Gear icon → **Project Settings**:

- Turn **Bluetooth** on
- Enable **No Pairing Required: Anyone can connect via Bluetooth**

### 4. Paste the player code

1. Open the **JavaScript** view (not Blocks).
2. Select all default code and delete it.
3. Paste the full contents of [`main.ts`](main.ts).
4. Errors should clear once both extensions are installed.

### 5. Download once

Connect the micro:bit V2 by USB → **Download**.

NeoPixel data wire → **P16** (must match the web designer).

On first boot with no animation saved, the micro:bit shows a **heart** icon.

## Send animations from the web designer

1. **Connect Bluetooth** → pick your micro:bit (tick icon on the display).
2. **Send over Bluetooth** → wait for per-frame progress.
3. **A** = next frame, **B** = previous frame (wraps around).

Animations are saved in flash and survive power-off.

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Cannot find name 'neopixel'` | Add the **neopixel** extension (step 2a) |
| `Cannot find name 'bluetooth'` | Add the **Bluetooth** extension (step 2b) |
| `Cannot find name 'settings'` | Use a **V2** project; update MakeCode if needed |
| `Parameter implicitly has an 'any' type` | Use the latest [`main.ts`](main.ts) (types are included) |

## Protocol (reference)

| Line from web | Meaning |
|---------------|---------|
| `R` | Reset upload buffer |
| `D<hex>` | Append RGB hex to current frame |
| `P` | Finish frame → player replies `A` |
| `S` | Save to flash and play → player replies `K` |
