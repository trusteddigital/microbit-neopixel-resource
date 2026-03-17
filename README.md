# micro:bit NeoPixel 8×8 Designer

A browser-based GUI for designing an 8×8 NeoPixel layout attached to `pin0` on a micro:bit, then pushing the generated MicroPython over a browser connection.

## Features

- 8×8 paintable grid (64 pixels total)
- Draw and erase tools
- Fill and clear actions
- Generates MicroPython using the official `neopixel.NeoPixel(pin0, 64)` API
- Connect + push workflow in-browser using `microbit-connection`

## Run locally

Because this uses browser APIs (WebUSB/Web Serial), run from a local server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Notes

- The script upload path in `microbit-connection` has changed across versions. The app supports common method names (`flashScript`, `writeScript`, `write`) and should be easy to adjust in `app.js` if your installed build differs.
- You may need to flash a compatible MicroPython firmware and allow browser permissions for your device.
