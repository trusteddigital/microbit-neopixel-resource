import {
  createWebUSBConnection,
  createWebBluetoothConnection,
  createUniversalHexFlashDataSource,
} from 'https://esm.sh/@microbit/microbit-connection@0.1.0';
import { MicropythonFsHex } from 'https://esm.sh/@microbit/microbit-fs@0.10.0';

const GRID_WIDTH = 8;
const GRID_HEIGHT = 8;
const PIXEL_COUNT = GRID_WIDTH * GRID_HEIGHT;

const gridEl = document.querySelector('#grid');
const colorInput = document.querySelector('#paint-color');
const recentColorsEl = document.querySelector('#recent-colors');
const fillGridBtn = document.querySelector('#fill-grid');
const clearGridBtn = document.querySelector('#clear-grid');
const resetProjectBtn = document.querySelector('#reset-project');
const connectUsbButton = document.querySelector('#connect-usb');
const connectBluetoothButton = document.querySelector('#connect-bluetooth');
const flashPlayerButton = document.querySelector('#flash-player');
const pushButton = document.querySelector('#push-button');
const statusEl = document.querySelector('#status');
const pythonPreviewEl = document.querySelector('#python-preview');
const framesListEl = document.querySelector('#frames-list');
const addFrameBtn = document.querySelector('#add-frame');
const frameCountEl = document.querySelector('#frame-count');
const serialLogEl = document.querySelector('#serial-log');
const serialRebootBtn = document.querySelector('#serial-reboot');
const serialClearBtn = document.querySelector('#serial-clear');

const RECENT_LIMIT = 10; // 5 × 2 palette
const blankFrame = () => Array.from({ length: PIXEL_COUNT }, () => '#000000');

let colors = blankFrame(); // live edit buffer for the selected frame
let frames = [blankFrame()]; // each entry is a PIXEL_COUNT-length array of hex strings
let currentFrameIndex = 0;
let recentColors = [];
let isPainting = false;
let strokeErases = false; // true while a right-click stroke is active
let dragIndex = null; // frame index being dragged
let microbit = null;
let connectionType = null; // 'usb' | 'bluetooth'
let serialAttached = false;
let uartAttached = false;

const STORAGE_KEY = 'microbit-neopixel-designer-bluetooth';
let saveTimer = null;

const snapshotState = () => ({
  frames,
  currentFrameIndex,
  paintColor: colorInput.value,
  recentColors,
});

const saveStateNow = () => {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotState()));
  } catch (error) {
    console.warn('[micro:bit] could not save state', error);
  }
};

const saveState = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, 300);
};

const isValidFrame = (frame) => (
  Array.isArray(frame)
  && frame.length === PIXEL_COUNT
  && frame.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
);

const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.frames) || data.frames.length === 0) return false;
    if (!data.frames.every(isValidFrame)) return false;

    frames = data.frames;
    currentFrameIndex = Math.min(
      Math.max(0, data.currentFrameIndex ?? 0),
      frames.length - 1,
    );
    if (typeof data.paintColor === 'string') colorInput.value = data.paintColor;
    if (Array.isArray(data.recentColors)) {
      recentColors = data.recentColors
        .filter((c) => typeof c === 'string')
        .slice(0, RECENT_LIMIT);
    }
    colors = frames[currentFrameIndex].slice();
    return true;
  } catch {
    return false;
  }
};

const resetProject = () => {
  if (!window.confirm('Clear your animation and start again?')) return;
  clearTimeout(saveTimer);
  localStorage.removeItem(STORAGE_KEY);
  frames = [blankFrame()];
  currentFrameIndex = 0;
  colors = blankFrame();
  recentColors = [];
  colorInput.value = '#FFFFFF';
  addRecentColor(colorInput.value);
  loadFrame(0);
};

window.addEventListener('beforeunload', () => {
  frames[currentFrameIndex] = colors.slice();
  saveStateNow();
});

const BRIGHTNESS = 0.4; // 0.0 → 1.0

const toRgbTuple = (hex) => {
  const normalized = hex.replace('#', '');
  const r = Math.round(parseInt(normalized.slice(0, 2), 16) * BRIGHTNESS);
  const g = Math.round(parseInt(normalized.slice(2, 4), 16) * BRIGHTNESS);
  const b = Math.round(parseInt(normalized.slice(4, 6), 16) * BRIGHTNESS);
  return [r, g, b];
};

// The matrix is physically wired 90° out from the editor layout, so rotate the
// grid 90° clockwise before flattening to the NeoPixel strip order. Swap to the
// counter-clockwise mapping (commented below) if the display ends up mirrored.
const rotate90 = (arr) => {
  const out = new Array(arr.length);
  for (let row = 0; row < GRID_HEIGHT; row += 1) {
    for (let col = 0; col < GRID_WIDTH; col += 1) {
      // clockwise: destination (row, col) <- source (GRID_HEIGHT-1-col, row)
      out[row * GRID_WIDTH + col] = arr[(GRID_HEIGHT - 1 - col) * GRID_WIDTH + row];
      // counter-clockwise alternative:
      // out[row * GRID_WIDTH + col] = arr[col * GRID_WIDTH + (GRID_WIDTH - 1 - row)];
    }
  }
  return out;
};

const FRAME_BYTES = PIXEL_COUNT * 3; // RGB per pixel
const FRAMES_FILE = 'frames.bin';

// Pack all frames into a flat byte array (RGB, brightness baked in, rotated to
// match the wiring). Used for USB MicroPython flash only.
const framesToBytes = () => {
  const bytes = new Uint8Array(frames.length * FRAME_BYTES);
  frames.forEach((frame, f) => {
    const rotated = rotate90(frame);
    for (let i = 0; i < PIXEL_COUNT; i += 1) {
      const [r, g, b] = toRgbTuple(rotated[i]);
      const o = f * FRAME_BYTES + i * 3;
      bytes[o] = r;
      bytes[o + 1] = g;
      bytes[o + 2] = b;
    }
  });
  return bytes;
};

// USB path only: MicroPython that reads frames.bin. Bluetooth uses the MakeCode
// player instead (see microbit-player/main.ts).
const toPython = () => {
  return [
    'from microbit import *',
    'import neopixel',
    '',
    `np = neopixel.NeoPixel(pin16, ${PIXEL_COUNT})`,
    `n = ${frames.length}`,
    `FB = ${FRAME_BYTES}`,
    '',
    'def show(k):',
    `    f = open("${FRAMES_FILE}", "rb")`,
    '    b = None',
    '    for _ in range(k + 1):',
    '        b = f.read(FB)',
    '    f.close()',
    `    for i in range(${PIXEL_COUNT}):`,
    '        p = i * 3',
    '        np[i] = (b[p], b[p + 1], b[p + 2])',
    '    np.show()',
    '',
    'idx = 0',
    'show(idx)',
    '',
    '# Tap A/B for one frame; hold 0.5s then play at 10 fps',
    'while True:',
    '    if button_a.was_pressed():',
    '        start = running_time()',
    '        while button_a.is_pressed():',
    '            if running_time() - start >= 500:',
    '                while button_a.is_pressed():',
    '                    idx = (idx + 1) % n',
    '                    show(idx)',
    '                    sleep(100)',
    '                break',
    '            sleep(20)',
    '        else:',
    '            idx = (idx + 1) % n',
    '            show(idx)',
    '    elif button_b.was_pressed():',
    '        start = running_time()',
    '        while button_b.is_pressed():',
    '            if running_time() - start >= 500:',
    '                while button_b.is_pressed():',
    '                    idx = (idx - 1) % n',
    '                    show(idx)',
    '                    sleep(100)',
    '                break',
    '            sleep(20)',
    '        else:',
    '            idx = (idx - 1) % n',
    '            show(idx)',
    '    else:',
    '        sleep(20)',
  ].join('\n');
};

const setStatus = (message) => {
  statusEl.textContent = `Status: ${message}`;
};

const debug = (message) => {
  console.log(`[micro:bit] ${message}`);
};

const updatePushLabel = () => {
  if (connectionType === 'bluetooth') {
    pushButton.textContent = 'Send over Bluetooth';
  } else if (connectionType === 'usb') {
    pushButton.textContent = 'Update micro:bit';
  } else {
    pushButton.textContent = 'Update micro:bit';
  }
};

// ── micro:bit serial monitor ──────────────────────────────────
const SERIAL_LOG_LIMIT = 20000; // characters to keep in the panel

const appendSerial = (text) => {
  let next = serialLogEl.textContent + text;
  if (next.length > SERIAL_LOG_LIMIT) next = next.slice(-SERIAL_LOG_LIMIT);
  serialLogEl.textContent = next;
  serialLogEl.scrollTop = serialLogEl.scrollHeight;
};

const isConnected = () => !!microbit && microbit.status === 'CONNECTED';

// Attach serial listeners once a connection exists. micro:bit serial data
// (including Python tracebacks) flows automatically over WebUSB after connect.
const attachSerial = () => {
  if (!microbit || serialAttached || typeof microbit.addEventListener !== 'function') return;
  microbit.addEventListener('serialdata', (event) => {
    appendSerial(event.data);
  });
  microbit.addEventListener('serialerror', (event) => {
    appendSerial(`\n[serial error] ${event.error}\n`);
  });
  // Keep buttons in step with the live connection so we never write to a closed
  // device (e.g. after unplugging or swapping micro:bits). Reboot is USB-only.
  microbit.addEventListener('status', () => {
    const live = isConnected();
    serialRebootBtn.disabled = !live || connectionType !== 'usb';
    if (!live) {
      pushButton.disabled = true;
      if (flashPlayerButton) flashPlayerButton.disabled = true;
      appendSerial('\n[micro:bit disconnected]\n');
    }
  });
  serialAttached = true;
  serialRebootBtn.disabled = connectionType !== 'usb';
  appendSerial('[serial connected — waiting for output]\n');
};

serialClearBtn.addEventListener('click', () => {
  serialLogEl.textContent = '';
});

serialRebootBtn.addEventListener('click', async () => {
  if (!isConnected() || connectionType !== 'usb') {
    appendSerial('\n[not connected via USB — connect a micro:bit first]\n');
    serialRebootBtn.disabled = true;
    return;
  }
  try {
    appendSerial('\n[rebooting micro:bit…]\n');
    // Ctrl-C interrupts a running loop, Ctrl-D soft-reboots and re-runs main.py.
    await microbit.serialWrite('\x03\x04');
  } catch (error) {
    appendSerial(`\n[reboot failed: ${error.message}]\n`);
  }
});

// ── Bluetooth UART transfer ───────────────────────────────────
// Over BLE we don't flash a program; the micro:bit already runs a MakeCode
// "player" (see microbit-player/). We stream frames to it over the UART
// service using a small line-based protocol with per-frame acknowledgements.
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let uartLineBuffer = '';
let uartWaiters = []; // { predicate, resolve }

const toHexByte = (n) => n.toString(16).padStart(2, '0');
const frameToHex = (frame) =>
  rotate90(frame).map((hex) => toRgbTuple(hex).map(toHexByte).join('')).join('');

const handleUartLine = (line) => {
  appendSerial(`< ${line}\n`);
  uartWaiters = uartWaiters.filter((w) => {
    if (w.predicate(line)) {
      w.resolve(line);
      return false;
    }
    return true;
  });
};

const onUartData = (event) => {
  const chunk = typeof event.data === 'string'
    ? event.data
    : textDecoder.decode(event.value ?? event.data);
  uartLineBuffer += chunk;
  let nl;
  while ((nl = uartLineBuffer.indexOf('\n')) >= 0) {
    const line = uartLineBuffer.slice(0, nl).replace(/\r$/, '');
    uartLineBuffer = uartLineBuffer.slice(nl + 1);
    if (line.length) handleUartLine(line);
  }
};

const attachUart = () => {
  if (uartAttached || !microbit || typeof microbit.addEventListener !== 'function') return;
  microbit.addEventListener('uartdata', onUartData);
  if (typeof microbit.startNotifications === 'function') {
    try { microbit.startNotifications('uartdata'); } catch (e) { /* auto-started */ }
  }
  uartAttached = true;
  appendSerial('[UART attached — waiting for player]\n');
};

const waitForLine = (predicate, timeoutMs) =>
  new Promise((resolve, reject) => {
    const waiter = { predicate, resolve };
    uartWaiters.push(waiter);
    setTimeout(() => {
      uartWaiters = uartWaiters.filter((w) => w !== waiter);
      reject(new Error('timed out waiting for micro:bit'));
    }, timeoutMs);
  });

// BLE characteristic writes are small; chunk to stay within the UART MTU.
const uartSend = async (str) => {
  const bytes = textEncoder.encode(str);
  const CHUNK = 20;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.slice(i, i + CHUNK);
    if (typeof microbit.uartWrite === 'function') {
      await microbit.uartWrite(slice);
    } else {
      throw new Error('this connection has no UART (is the BLE player flashed?)');
    }
  }
};

const sendFramesOverBluetooth = async () => {
  if (!isConnected()) throw new Error('not connected');
  if (typeof microbit.uartWrite !== 'function') {
    throw new Error('this connection has no UART (is the BLE player flashed?)');
  }
  attachUart();

  setStatus('Bluetooth: starting transfer…');
  appendSerial(`> R  (${frames.length} frames)\n`);
  await uartSend('R\n'); // reset upload buffer on the player
  await waitForLine((l) => l === 'R' || l.startsWith('R'), 4000).catch(() => {
    // Player may not echo ready; continue and rely on per-frame acks.
    appendSerial('[no R ack — continuing]\n');
  });

  for (let i = 0; i < frames.length; i += 1) {
    const hex = frameToHex(frames[i]); // 384 hex chars per frame
    // Send in small data lines, then a "push frame" marker the player acks.
    for (let p = 0; p < hex.length; p += 32) {
      await uartSend(`D${hex.slice(p, p + 32)}\n`);
    }
    await uartSend('P\n');
    await waitForLine((l) => l.startsWith('A'), 8000);
    setStatus(`Bluetooth: sent frame ${i + 1}/${frames.length}…`);
  }

  await uartSend('S\n'); // save to flash and start playing
  await waitForLine((l) => l === 'K' || l.startsWith('K'), 10000);
  setStatus('Bluetooth: animation saved on micro:bit.');
  appendSerial('[saved to flash — will reload on next power-on]\n');
};

const paintCell = (idx) => {
  const cell = gridEl.children[idx];
  if (!cell) return;
  cell.style.backgroundColor = colors[idx];
  cell.classList.toggle('lit', colors[idx] !== '#000000');
};

const render = () => {
  for (let i = 0; i < PIXEL_COUNT; i += 1) paintCell(i);
  pythonPreviewEl.textContent = toPython();
};

const applyColor = (idx) => {
  colors[idx] = strokeErases ? '#000000' : colorInput.value;
};

// ── Animation frames ──────────────────────────────────────────
const commit = () => {
  frames[currentFrameIndex] = colors.slice();
  paintThumb(framesListEl.querySelector(`.frame-thumb[data-index="${currentFrameIndex}"] canvas`), colors);
  pythonPreviewEl.textContent = toPython();
  saveState();
};

const loadFrame = (index) => {
  const next = Math.max(0, Math.min(index, frames.length - 1));
  if (next !== currentFrameIndex) {
    frames[currentFrameIndex] = colors.slice();
  }
  currentFrameIndex = next;
  colors = frames[currentFrameIndex].slice();
  render();
  renderStrip();
  saveStateNow();
};

const addFrame = (frame) => {
  frames.splice(currentFrameIndex + 1, 0, frame);
  loadFrame(currentFrameIndex + 1);
};

const deleteFrame = (index) => {
  frames.splice(index, 1);
  if (frames.length === 0) frames.push(blankFrame());
  loadFrame(Math.min(index, frames.length - 1));
};

const paintThumb = (canvas, frame) => {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
  for (let i = 0; i < PIXEL_COUNT; i += 1) {
    ctx.fillStyle = frame[i];
    ctx.fillRect(i % GRID_WIDTH, Math.floor(i / GRID_WIDTH), 1, 1);
  }
};

const renderStrip = () => {
  framesListEl.innerHTML = '';

  frames.forEach((frame, index) => {
    const tile = document.createElement('div');
    tile.className = 'frame-thumb';
    tile.dataset.index = index;
    tile.draggable = true;
    tile.classList.toggle('selected', index === currentFrameIndex);

    const canvas = document.createElement('canvas');
    canvas.width = GRID_WIDTH;
    canvas.height = GRID_HEIGHT;
    tile.append(canvas);
    paintThumb(canvas, frame);

    const num = document.createElement('span');
    num.className = 'frame-thumb__num';
    num.textContent = index + 1;
    tile.append(num);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'frame-thumb__del';
    del.title = 'Delete frame';
    del.textContent = '×';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteFrame(index);
    });
    tile.append(del);

    tile.addEventListener('click', () => loadFrame(index));

    tile.addEventListener('dragstart', (event) => {
      dragIndex = index;
      tile.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
    });
    tile.addEventListener('dragend', () => {
      dragIndex = null;
      [...framesListEl.children].forEach((c) => c.classList.remove('dragging', 'drag-over'));
    });
    tile.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (dragIndex !== null && index !== dragIndex) tile.classList.add('drag-over');
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
    tile.addEventListener('drop', (event) => {
      event.preventDefault();
      tile.classList.remove('drag-over');
      if (dragIndex === null || dragIndex === index) return;
      const [moved] = frames.splice(dragIndex, 1);
      frames.splice(index, 0, moved);
      let newSelected = currentFrameIndex;
      if (currentFrameIndex === dragIndex) {
        newSelected = index;
      } else if (dragIndex < currentFrameIndex && index >= currentFrameIndex) {
        newSelected = currentFrameIndex - 1;
      } else if (dragIndex > currentFrameIndex && index <= currentFrameIndex) {
        newSelected = currentFrameIndex + 1;
      }
      currentFrameIndex = newSelected;
      dragIndex = null;
      renderStrip();
      saveStateNow();
    });

    framesListEl.append(tile);
  });

  const addTile = document.createElement('button');
  addTile.type = 'button';
  addTile.className = 'frame-thumb frame-thumb--add';
  addTile.title = 'New blank frame';
  addTile.textContent = '＋';
  addTile.addEventListener('click', () => addFrame(blankFrame()));
  framesListEl.append(addTile);

  const label = `${frames.length} ${frames.length === 1 ? 'frame' : 'frames'}`;
  const dataBytes = frames.length * PIXEL_COUNT * 3;
  // MakeCode settings flash is smaller than MicroPython FS — warn earlier.
  const heavy = dataBytes > 8000;
  frameCountEl.textContent = `${label} · ${(dataBytes / 1024).toFixed(1)}KB`;
  frameCountEl.classList.toggle('warn', heavy);
  frameCountEl.title = heavy
    ? 'Large animation — may exceed MakeCode settings flash on the micro:bit.'
    : '';
};

// ── Recent colours palette (5 × 2) ────────────────────────────
const addRecentColor = (hex) => {
  const value = hex.toLowerCase();
  recentColors = [value, ...recentColors.filter((c) => c !== value)].slice(0, RECENT_LIMIT);
  renderRecentColors();
  saveState();
};

const renderRecentColors = () => {
  recentColorsEl.innerHTML = '';
  const selected = colorInput.value.toLowerCase();
  for (let i = 0; i < RECENT_LIMIT; i += 1) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    const hex = recentColors[i];
    if (hex) {
      swatch.style.backgroundColor = hex;
      swatch.title = hex;
      swatch.classList.toggle('selected', hex === selected);
      swatch.addEventListener('click', () => {
        colorInput.value = hex;
        renderRecentColors();
      });
    } else {
      swatch.classList.add('empty');
      swatch.disabled = true;
    }
    recentColorsEl.append(swatch);
  }
};

colorInput.addEventListener('change', () => {
  addRecentColor(colorInput.value);
});
colorInput.addEventListener('input', () => {
  renderRecentColors();
  saveState();
});

const createGrid = () => {
  for (let i = 0; i < PIXEL_COUNT; i += 1) {
    const btn = document.createElement('button');
    btn.className = 'pixel';
    btn.type = 'button';
    btn.dataset.index = i;
    btn.addEventListener('mousedown', (event) => {
      event.preventDefault();
      strokeErases = event.button === 2; // right-click erases
      isPainting = true;
      applyColor(i);
      paintCell(i);
    });
    btn.addEventListener('mouseenter', () => {
      if (!isPainting) return;
      applyColor(i);
      paintCell(i);
    });
    gridEl.append(btn);
  }

  gridEl.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('mouseup', () => {
    if (!isPainting) return;
    isPainting = false;
    commit();
  });
};

const connectMicrobit = async (type) => {
  microbit = type === 'bluetooth'
    ? createWebBluetoothConnection()
    : createWebUSBConnection();
  connectionType = type;
  serialAttached = false;
  uartAttached = false;
  uartLineBuffer = '';
  uartWaiters = [];

  if (!microbit) {
    debug(`Error: ${type} SDK not available`);
    return null;
  }

  debug(`Connecting via ${type}...`);
  await microbit.connect();
  const boardVersion = microbit.getBoardVersion?.() ?? 'unknown';
  debug(`Connected via ${type} to micro:bit ${boardVersion}`);
  return microbit;
};

connectUsbButton.addEventListener('click', async () => {
  try {
    setStatus('Connecting via USB… approve the browser device prompt.');
    const adapter = await connectMicrobit('usb');
    if (!adapter) {
      setStatus('Failed to load USB library.');
      return;
    }
    pushButton.disabled = false;
    flashPlayerButton.disabled = false;
    updatePushLabel();
    attachSerial();
    setStatus('Connected via USB. Flash the BLE player once, or send a MicroPython animation.');
  } catch (error) {
    debug(`USB connection error: ${error.message}`);
    setStatus(`USB connection failed (${error.message})`);
  }
});

const flashBlePlayer = async () => {
  setStatus('Loading BLE player hex…');
  const hexResponse = await fetch('vendor/neopixel-bluetooth-player.hex');
  if (!hexResponse.ok) {
    throw new Error(
      'Player hex missing. Build microbit-player/firmware (see README) and place '
      + 'vendor/neopixel-bluetooth-player.hex',
    );
  }
  const playerHex = await hexResponse.text();
  debug(`Player hex loaded (${playerHex.length} bytes)`);
  const flashDataSource = createUniversalHexFlashDataSource(playerHex);
  setStatus('Flashing BLE player…');
  await microbit.flash(flashDataSource, {
    partial: false,
    progress: (percentage) => {
      if (percentage !== undefined) {
        setStatus(`Flashing BLE player… ${Math.round(percentage * 100)}%`);
      }
    },
  });
  setStatus('BLE player installed. Disconnect USB, then Connect Bluetooth.');
};

flashPlayerButton.addEventListener('click', async () => {
  if (connectionType !== 'usb' || !isConnected()) {
    setStatus('Connect via USB first to flash the BLE player.');
    return;
  }
  flashPlayerButton.disabled = true;
  pushButton.disabled = true;
  try {
    await flashBlePlayer();
  } catch (error) {
    debug(`Flash player error: ${error.message}`);
    setStatus(`Flash player failed (${error.message})`);
  } finally {
    if (isConnected()) {
      flashPlayerButton.disabled = false;
      pushButton.disabled = false;
    }
  }
});

connectBluetoothButton.addEventListener('click', async () => {
  try {
    setStatus('Connecting via Bluetooth… approve the browser device prompt.');
    const adapter = await connectMicrobit('bluetooth');
    if (!adapter) {
      setStatus('Failed to load Bluetooth library.');
      return;
    }
    pushButton.disabled = false;
    flashPlayerButton.disabled = true;
    updatePushLabel();
    attachSerial();
    attachUart();
    setStatus('Connected via Bluetooth. Send animations to the CODAL player.');
  } catch (error) {
    debug(`Bluetooth connection error: ${error.message}`);
    setStatus(`Bluetooth connection failed (${error.message})`);
  }
});

const pushScript = async () => {
  const script = toPython();
  debug(script);

  try {
    setStatus('Loading hex file…');
    debug('Loading hex file from vendor folder...');

    let baseHex = null;
    try {
      const boardVersion = microbit.getBoardVersion();
      const hexFile = boardVersion === 'V2'
        ? 'vendor/micropython-microbit-v2.1.2.hex'
        : 'vendor/micropython-microbit-v1.1.1.hex';
      const hexResponse = await fetch(hexFile);
      if (!hexResponse.ok) {
        throw new Error(`HTTP ${hexResponse.status}`);
      }
      baseHex = await hexResponse.text();
      debug(`Successfully loaded hex file (${baseHex.length} bytes)`);
    } catch (e) {
      debug(`Failed to load hex from vendor folder: ${e.message}`);
      setStatus('Could not load hex file. Please select a MicroPython hex file from your device.');
      const userHex = await promptForHexFile();
      if (!userHex) {
        throw new Error('No hex file provided. Upload cancelled.');
      }
      baseHex = userHex;
      debug(`User provided hex file (${baseHex.length} bytes)`);
    }

    setStatus('Embedding script into hex…');
    debug('Embedding Python script into hex file...');
    const fs = new MicropythonFsHex(baseHex);
    fs.write('main.py', script);
    const frameBytes = framesToBytes();
    fs.write(FRAMES_FILE, frameBytes);
    debug(`Wrote ${FRAMES_FILE} (${frameBytes.length} bytes, ${frames.length} frames)`);
    const embeddedHex = fs.getIntelHex();
    debug(`Embedded hex size: ${embeddedHex.length} bytes`);

    debug('Creating flash data source...');
    const flashDataSource = createUniversalHexFlashDataSource(embeddedHex);

    setStatus('Uploading to micro:bit…');
    debug('Starting flash operation...');
    await microbit.flash(flashDataSource, {
      partial: true,
      progress: (percentage) => {
        if (percentage !== undefined) {
          const percent = Math.round(percentage * 100);
          setStatus(`Uploading to micro:bit… ${percent}%`);
        }
      },
    });

    debug('Flash operation completed successfully');
    setStatus('Upload complete.');
  } catch (error) {
    throw new Error(`Script upload failed: ${error.message}`);
  }
};

const promptForHexFile = async () => {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.hex';
    input.onchange = async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        const hexContent = await file.text();
        resolve(hexContent);
      } else {
        resolve(null);
      }
    };
    input.click();
  });
};

pushButton.addEventListener('click', async () => {
  pushButton.disabled = true;
  try {
    debug('Push button clicked');
    if (connectionType === 'bluetooth') {
      await sendFramesOverBluetooth();
    } else {
      setStatus('uploading script to micro:bit…');
      await pushScript();
      setStatus('upload complete.');
    }
  } catch (error) {
    debug(`Push error: ${error.message}`);
    setStatus(`${connectionType === 'bluetooth' ? 'Bluetooth send' : 'upload'} failed (${error.message})`);
  } finally {
    if (isConnected()) pushButton.disabled = false;
  }
});

fillGridBtn.addEventListener('click', () => {
  colors.fill(colorInput.value);
  render();
  commit();
});

clearGridBtn.addEventListener('click', () => {
  colors.fill('#000000');
  render();
  commit();
});

addFrameBtn.addEventListener('click', () => addFrame(colors.slice()));

resetProjectBtn.addEventListener('click', resetProject);

createGrid();
if (loadState()) {
  renderRecentColors();
  render();
  renderStrip();
} else {
  addRecentColor(colorInput.value);
  loadFrame(0);
}
