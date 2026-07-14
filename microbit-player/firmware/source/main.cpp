/*
 * RGS NeoPixel Bluetooth Player — micro:bit V2 CODAL firmware
 *
 * MakeCode cannot combine NeoPixel + Bluetooth. This custom CODAL build does:
 *   - PWM NeoPixels (HARDWARE_NEOPIXEL) — SoftDevice-safe
 *   - BLE UART (open link, no pairing) for the web designer
 *   - Animation persistence in dedicated flash pages (survives power-off)
 *
 * Protocol (newline-terminated, same as the web app):
 *   R          reset upload buffer → reply R
 *   D<hex>     append RGB hex to current frame
 *   P          finish frame → reply A
 *   S          save to flash + show frame 0 → reply K
 *
 * NeoPixels on P16. Tap A/B = step; hold ≥500 ms = play at 10 fps.
 */

#include "MicroBit.h"
#include "neopixel.h"
#include <string.h>
#include <stdlib.h>

#if !CONFIG_ENABLED(DEVICE_BLE)
#error "This firmware requires DEVICE_BLE / MICROBIT_BLE_ENABLED"
#endif

MicroBit uBit;

static const int PIXELS = 64;
static const int FRAME_BYTES = PIXELS * 3;       // 192
static const int HEX_PER_FRAME = FRAME_BYTES * 2; // 384
static const int MAX_FRAMES = 40;                // ~7.5 KB RGB + header

static const uint32_t ANIM_MAGIC = 0x31534752;   // "RGS1" little-endian tag
static const int ANIM_FLASH_PAGES = 4;           // 16 KB below KV scratch

// Flash layout (from bootloader downward): FDS, KV store, scratch, then us.
#define ANIM_FLASH_START \
  (MICROBIT_DEFAULT_SCRATCH_PAGE - (ANIM_FLASH_PAGES * MICROBIT_CODEPAGESIZE))

struct AnimHeader {
  uint32_t magic;
  uint32_t frameCount;
  uint32_t dataBytes;
  uint32_t reserved;
};

static MicroBitUARTService *uart = nullptr;
static NRF52FlashManager *animFlash = nullptr;

static uint8_t frameData[MAX_FRAMES * FRAME_BYTES];
static int frameCount = 0;
static int idx = 0;

static char curHex[HEX_PER_FRAME + 8];
static int curHexLen = 0;

static uint8_t showBuf[FRAME_BYTES];

static int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}

static uint8_t hexByteAt(const char *hex, int byteIndex) {
  int i = byteIndex * 2;
  return (uint8_t)((hexNibble(hex[i]) << 4) | hexNibble(hex[i + 1]));
}

static void showFrame(int k) {
  if (frameCount <= 0 || k < 0 || k >= frameCount) return;
  const uint8_t *src = &frameData[k * FRAME_BYTES];
  memcpy(showBuf, src, FRAME_BYTES);
  // PWM NeoPixel driver — does not disable IRQs, so BLE stays alive.
  neopixel_send_buffer(uBit.io.P16, showBuf, FRAME_BYTES);
}

static void uartReply(const char *s) {
  if (!uart) return;
  uart->send(ManagedString(s));
}

static void resetUpload() {
  frameCount = 0;
  curHexLen = 0;
  idx = 0;
}

static bool appendFrameFromHex(const char *hex) {
  if (frameCount >= MAX_FRAMES) return false;
  uint8_t *dest = &frameData[frameCount * FRAME_BYTES];
  for (int i = 0; i < FRAME_BYTES; i++) {
    dest[i] = hexByteAt(hex, i);
  }
  frameCount++;
  return true;
}

static void saveToFlash() {
  if (!animFlash) return;

  AnimHeader header;
  header.magic = ANIM_MAGIC;
  header.frameCount = (uint32_t)frameCount;
  header.dataBytes = (uint32_t)(frameCount * FRAME_BYTES);
  header.reserved = 0;

  // Erase all reserved pages first.
  uint32_t pageSize = animFlash->getPageSize();
  for (int p = 0; p < ANIM_FLASH_PAGES; p++) {
    animFlash->erase(p * pageSize);
  }

  // Build a word-aligned payload: header + RGB bytes (pad to 4).
  uint32_t payloadBytes = sizeof(AnimHeader) + header.dataBytes;
  uint32_t wordCount = (payloadBytes + 3) / 4;
  uint32_t *words = (uint32_t *)malloc(wordCount * 4);
  if (!words) return;
  memset(words, 0xFF, wordCount * 4);
  memcpy(words, &header, sizeof(AnimHeader));
  if (header.dataBytes > 0) {
    memcpy(((uint8_t *)words) + sizeof(AnimHeader), frameData, header.dataBytes);
  }

  // SoftDevice flash writes are chunked.
  const uint32_t CHUNK = 64; // words
  uint32_t offset = 0;
  while (offset < wordCount) {
    uint32_t n = wordCount - offset;
    if (n > CHUNK) n = CHUNK;
    animFlash->write(offset * 4, words + offset, n);
    offset += n;
  }

  free(words);
}

static void loadFromFlash() {
  frameCount = 0;
  idx = 0;
  if (!animFlash) return;

  AnimHeader header;
  animFlash->read((uint32_t *)&header, 0, sizeof(AnimHeader) / 4);
  if (header.magic != ANIM_MAGIC) return;
  if (header.frameCount == 0 || header.frameCount > (uint32_t)MAX_FRAMES) return;
  if (header.dataBytes != header.frameCount * (uint32_t)FRAME_BYTES) return;

  uint32_t wordCount = (header.dataBytes + 3) / 4;
  uint32_t *words = (uint32_t *)malloc(wordCount * 4);
  if (!words) return;
  animFlash->read(words, sizeof(AnimHeader), wordCount);
  memcpy(frameData, words, header.dataBytes);
  free(words);

  frameCount = (int)header.frameCount;
}

static void stepForward() {
  if (frameCount == 0) return;
  idx = (idx + 1) % frameCount;
  showFrame(idx);
}

static void stepBack() {
  if (frameCount == 0) return;
  idx = (idx - 1 + frameCount) % frameCount;
  showFrame(idx);
}

static void handleLine(ManagedString line) {
  int len = line.length();
  if (len <= 0) return;

  // Drop trailing CR if a client sent \r\n.
  if (line.charAt(len - 1) == '\r') {
    line = line.substring(0, len - 1);
    len = line.length();
    if (len <= 0) return;
  }

  char cmd = line.charAt(0);
  if (cmd == 'R') {
    resetUpload();
    uartReply("R\n");
  } else if (cmd == 'D') {
    int plen = len - 1;
    if (plen > 0 && curHexLen + plen <= HEX_PER_FRAME) {
      memcpy(curHex + curHexLen, line.toCharArray() + 1, plen);
      curHexLen += plen;
      curHex[curHexLen] = '\0';
    }
  } else if (cmd == 'P') {
    if (curHexLen >= HEX_PER_FRAME) {
      appendFrameFromHex(curHex);
    }
    curHexLen = 0;
    uartReply("A\n");
  } else if (cmd == 'S') {
    saveToFlash();
    idx = 0;
    if (frameCount > 0) {
      showFrame(0);
    }
    uartReply("K\n");
  }
}

static void onConnected(MicroBitEvent) {
  uBit.display.print(ManagedString("C"));
  uartReply("R\n");
}

static void onDisconnected(MicroBitEvent) {
  uBit.display.print(ManagedString("D"));
  if (frameCount > 0) showFrame(idx);
}

static void onUartDelim(MicroBitEvent) {
  ManagedString line = uart->readUntil(ManagedString("\n"));
  if (line.length() > 0) handleLine(line);
}

static void onButtonA(MicroBitEvent) {
  if (frameCount == 0) return;
  unsigned long start = uBit.systemTime();
  while (uBit.buttonA.isPressed()) {
    if (uBit.systemTime() - start >= 500) {
      while (uBit.buttonA.isPressed()) {
        stepForward();
        uBit.sleep(100);
      }
      return;
    }
    uBit.sleep(20);
  }
  stepForward();
}

static void onButtonB(MicroBitEvent) {
  if (frameCount == 0) return;
  unsigned long start = uBit.systemTime();
  while (uBit.buttonB.isPressed()) {
    if (uBit.systemTime() - start >= 500) {
      while (uBit.buttonB.isPressed()) {
        stepBack();
        uBit.sleep(100);
      }
      return;
    }
    uBit.sleep(20);
  }
  stepBack();
}

int main() {
  uBit.init();

  animFlash = new NRF52FlashManager(
    ANIM_FLASH_START,
    ANIM_FLASH_PAGES,
    MICROBIT_CODEPAGESIZE
  );

  loadFromFlash();

  uBit.messageBus.listen(MICROBIT_ID_BLE, MICROBIT_BLE_EVT_CONNECTED, onConnected);
  uBit.messageBus.listen(MICROBIT_ID_BLE, MICROBIT_BLE_EVT_DISCONNECTED, onDisconnected);
  uBit.messageBus.listen(MICROBIT_ID_BLE_UART, MICROBIT_UART_S_EVT_DELIM_MATCH, onUartDelim);
  uBit.messageBus.listen(DEVICE_ID_BUTTON_A, DEVICE_BUTTON_EVT_DOWN, onButtonA);
  uBit.messageBus.listen(DEVICE_ID_BUTTON_B, DEVICE_BUTTON_EVT_DOWN, onButtonB);

  // Larger RX buffer for hex chunks from the browser.
  uart = new MicroBitUARTService(*uBit.ble, 128, 64);
  uart->eventOn(ManagedString("\n"));

  if (frameCount > 0) {
    showFrame(0);
    uBit.display.print(ManagedString("P")); // Player ready with saved animation
  } else {
    // Heart-like pattern on the 5×5 while waiting for first upload.
    uBit.display.print(ManagedString("H"));
  }

  release_fiber();
}
