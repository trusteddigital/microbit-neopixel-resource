# micro:bit NeoPixel 8×8 Designer

A browser-based GUI for designing an 8×8 NeoPixel layout attached to `pin0` on a micro:bit, then pushing the generated MicroPython over a browser connection.

## Features

- 8×8 paintable grid (64 pixels total)
- Draw and erase tools
- Fill and clear actions
- Generates MicroPython using the official `neopixel.NeoPixel(pin0, 64)` API
- Connect + push workflow in-browser using `@microbit/microbit-connection` (ESM module via esm.sh CDN)

## Run locally

Because this uses browser APIs (WebUSB/Web Serial), run from a local server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Notes

- The app loads `@microbit/microbit-connection` as an ES module from `esm.sh`. This CDN does not have Tracking Prevention restrictions like unpkg.
- The app generates MicroPython code for your NeoPixel pattern and uses WebUSB to push it directly to a connected micro:bit.
- To push scripts, you must connect a **physical micro:bit** with WebUSB support via a USB cable.
- The app uses `@microbit/microbit-fs` to generate Intel Hex files from the Python code, then flashes them using the official micro:bit WebUSB library.

## Push to micro:bit workflow

1. **Design your pattern** in the 8×8 grid.
2. **Click "Connect micro:bit"** and approve the USB device selection prompt.
3. **Click "Push to micro:bit"**:
   - The app will auto-detect your board version (V1 or V2).
   - It will automatically download a base MicroPython hex file for your board.
   - Your pattern will be embedded into the hex.
   - The complete hex is uploaded to your device.
4. The device will run the code immediately and display your pattern!

## How it works

- The app uses the `@microbit/microbit-fs` library to embed your Python script into a standard MicroPython hex file.
- No manual hex file downloads needed — everything happens automatically.
- If auto-download fails (network issues), you can manually upload a MicroPython hex file.

## Troubleshooting

- **No USB device listed**: Ensure your micro:bit is connected via USB cable and that WebUSB is available in your browser (Chrome/Edge on Windows/Mac/Linux, or Safari on macOS).
- **"Could not detect board version"**: Try disconnecting and reconnecting your micro:bit, then click "Connect micro:bit" again.
- **"Could not auto-download hex"**: Your network may be blocking external downloads. Manually upload a MicroPython hex file when prompted. Download from: [microbit.org/get-started/user-guide/firmware/](https://microbit.org/get-started/user-guide/firmware/)
- **Flash fails**: Ensure your micro:bit has valid MicroPython installed. If corrupted, download a fresh [Universal Hex](https://microbit.org/get-started/user-guide/firmware/) and flash in maintenance mode first.
- **Network issues**: The library and hex downloads use CDNs. Ensure your internet connection is stable and CDNs are not blocked.
