// =============================================================================
// RGS NeoPixel Bluetooth Player — micro:bit V2 only
//
// ADD EXTENSIONS FIRST (or you get "Cannot find name neopixel/bluetooth"):
//   1. New project at makecode.microbit.org — confirm V2 (not V1) bottom-right
//   2. Extensions → search "neopixel" → add Microsoft neopixel
//   3. Extensions → search "bluetooth" → add Bluetooth
//   4. Gear icon → Project Settings → enable "No Pairing Required"
//   5. JavaScript view → delete all → paste THIS file → Download
//
// NeoPixels on P16. A = next frame, B = previous frame.
// =============================================================================

let PIXELS = 64
let FRAME_BYTES = 192
let HEX_PER_FRAME = FRAME_BYTES * 2

let strip = neopixel.create(DigitalPin.P16, PIXELS, NeoPixelMode.RGB)
strip.setBrightness(255)

let frameCount = 0
let frameData = pins.createBuffer(0)
let curHex = ""
let idx = 0

function showFrame(k: number) {
    if (frameCount == 0) return
    let base = k * FRAME_BYTES
    for (let i = 0; i < PIXELS; i++) {
        let p = base + i * 3
        strip.setPixelColor(i, neopixel.rgb(frameData[p], frameData[p + 1], frameData[p + 2]))
    }
    strip.show()
}

function hexNibble(c: number) {
    if (c >= 48 && c <= 57) return c - 48
    if (c >= 97 && c <= 102) return c - 87
    if (c >= 65 && c <= 70) return c - 55
    return 0
}

function hexByteAt(hex: string, byteIndex: number) {
    let i = byteIndex * 2
    return (hexNibble(hex.charCodeAt(i)) << 4) | hexNibble(hex.charCodeAt(i + 1))
}

function toHexByte(b: number) {
    let digits = "0123456789abcdef"
    return digits.charAt((b >> 4) & 15) + digits.charAt(b & 15)
}

function appendFrameFromHex(hex: string) {
    let need = (frameCount + 1) * FRAME_BYTES
    let nb = pins.createBuffer(need)
    for (let i = 0; i < frameData.length; i++) {
        nb[i] = frameData[i]
    }
    let base = frameCount * FRAME_BYTES
    for (let i = 0; i < FRAME_BYTES; i++) {
        nb[base + i] = hexByteAt(hex, i)
    }
    frameData = nb
    frameCount += 1
}

function saveToFlash() {
    let hex = ""
    for (let f = 0; f < frameCount; f++) {
        let base = f * FRAME_BYTES
        for (let i = 0; i < FRAME_BYTES; i++) {
            hex = hex + toHexByte(frameData[base + i])
        }
    }
    settings.writeNumber("N", frameCount)
    settings.writeString("FR", hex)
}

function loadFromFlash() {
    frameCount = settings.readNumber("N")
    if (frameCount == null) frameCount = 0
    let hex = settings.readString("FR")
    if (!hex) hex = ""
    frameData = pins.createBuffer(0)
    if (frameCount > 0 && hex.length >= frameCount * HEX_PER_FRAME) {
        let need = frameCount * FRAME_BYTES
        frameData = pins.createBuffer(need)
        for (let i = 0; i < need; i++) {
            frameData[i] = hexByteAt(hex, i)
        }
    } else {
        frameCount = 0
    }
}

bluetooth.startUartService()

bluetooth.onBluetoothConnected(function () {
    basic.showIcon(IconNames.Yes)
    bluetooth.uartWriteString("R\n")
})

bluetooth.onBluetoothDisconnected(function () {
    basic.showIcon(IconNames.No)
    showFrame(idx)
})

bluetooth.onUartDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    let s = bluetooth.uartReadUntil(serial.delimiters(Delimiters.NewLine))
    if (s.length == 0) return
    let cmd = s.charAt(0)
    if (cmd == "R") {
        frameCount = 0
        frameData = pins.createBuffer(0)
        curHex = ""
        bluetooth.uartWriteString("R\n")
    } else if (cmd == "D") {
        curHex = curHex + s.substr(1)
    } else if (cmd == "P") {
        if (curHex.length >= HEX_PER_FRAME) {
            appendFrameFromHex(curHex.substr(0, HEX_PER_FRAME))
        }
        curHex = ""
        bluetooth.uartWriteString("A\n")
    } else if (cmd == "S") {
        saveToFlash()
        idx = 0
        showFrame(0)
        bluetooth.uartWriteString("K\n")
    }
})

input.onButtonPressed(Button.A, function () {
    if (frameCount == 0) return
    idx = (idx + 1) % frameCount
    showFrame(idx)
})

input.onButtonPressed(Button.B, function () {
    if (frameCount == 0) return
    idx = (idx - 1 + frameCount) % frameCount
    showFrame(idx)
})

loadFromFlash()
if (frameCount > 0) {
    showFrame(0)
} else {
    basic.showIcon(IconNames.Heart)
}
