import { createWebUSBConnection, createWebBluetoothConnection, createUniversalHexFlashDataSource } from 'https://esm.sh/@microbit/microbit-connection@0.1.0';
import { MicropythonFsHex } from 'https://esm.sh/@microbit/microbit-fs@0.10.0';
import { microbitBoardId } from 'https://esm.sh/@microbit/microbit-fs@0.10.0';

const GRID_WIDTH = 8;
const GRID_HEIGHT = 8;
const PIXEL_COUNT = GRID_WIDTH * GRID_HEIGHT;

const gridEl = document.querySelector('#grid');
const colorInput = document.querySelector('#paint-color');
const drawModeBtn = document.querySelector('#draw-mode');
const eraseModeBtn = document.querySelector('#erase-mode');
const fillGridBtn = document.querySelector('#fill-grid');
const clearGridBtn = document.querySelector('#clear-grid');
const connectUsbButton = document.querySelector('#connect-usb');
const connectBluetoothButton = document.querySelector('#connect-bluetooth');
const pushButton = document.querySelector('#push-button');
const statusEl = document.querySelector('#status');
const pythonPreviewEl = document.querySelector('#python-preview');

const colors = Array.from({ length: PIXEL_COUNT }, () => '#000000');
let paintMode = 'draw';
let isPainting = false;
let microbit = null;

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

const toPython = () => {
  const tuples = rotate90(colors).map((hex) => `(${toRgbTuple(hex).join(',')})`).join(', ');
  return [
    'from microbit import *',
    'import neopixel',
    'import time',
    '',
    '# Initialize NeoPixel strip on pin16 with 64 pixels',
    `np = neopixel.NeoPixel(pin16, ${PIXEL_COUNT})`,
    '',
    '# Define the color pattern',
    `pixels = [${tuples}]`,
    '',
    '# Write each pixel',
    'for i, value in enumerate(pixels):',
    '    np[i] = value',
    '',
    '# Display the pattern',
    'np.show()',
  ].join('\n');
};

const setStatus = (message) => {
  statusEl.textContent = `Status: ${message}`;
};

let debugContainer = null;

const getDebugContainer = () => {
  if (!debugContainer) {
    debugContainer = document.createElement('div');
    debugContainer.id = 'debug-log';
    debugContainer.style.marginTop = '12px';
    debugContainer.style.padding = '8px';
    debugContainer.style.backgroundColor = '#f5f5f5';
    debugContainer.style.borderRadius = '4px';
    debugContainer.style.maxHeight = '150px';
    debugContainer.style.overflowY = 'auto';
    statusEl.parentElement.appendChild(debugContainer);
    
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear Debug Log';
    clearBtn.style.fontSize = '12px';
    clearBtn.style.marginTop = '8px';
    clearBtn.style.padding = '4px 8px';
    clearBtn.onclick = () => {
      debugContainer.innerHTML = '';
      console.clear();
    };
    debugContainer.parentElement.appendChild(clearBtn);
  }
  return debugContainer;
};

const debug = (message) => {
  console.log(`[DEBUG] ${message}`);
  const container = getDebugContainer();
  const debugLine = document.createElement('div');
  debugLine.style.fontSize = '10px';
  debugLine.style.color = '#666';
  debugLine.style.fontFamily = 'monospace';
  debugLine.style.marginTop = '2px';
  debugLine.textContent = `🔧 ${message}`;
  container.appendChild(debugLine);
  container.scrollTop = container.scrollHeight;
};

const render = () => {
  [...gridEl.children].forEach((cell, i) => {
    cell.style.backgroundColor = colors[i];
  });
  pythonPreviewEl.textContent = toPython();
};

const applyColor = (idx) => {
  colors[idx] = paintMode === 'erase' ? '#000000' : colorInput.value;
};

// ── Image import ──────────────────────────────────────────────
const imageFileInput = document.querySelector('#image-file-input');
const importImageBtn = document.querySelector('#import-image');

const PRESETS = {
  christmas: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
    <rect width="8" height="8" fill="#0a0a2a"/>
    <polygon points="4,0 1,3 2,3 0.5,5.5 2,5.5 1,7 7,7 6,5.5 7.5,5.5 6,3 7,3" fill="#2d8c2d"/>
    <rect x="3" y="7" width="2" height="1" fill="#8B4513"/>
    <circle cx="4" cy="0.5" r="0.4" fill="#FFD700"/>
    <circle cx="2.5" cy="3.5" r="0.35" fill="#ff0000"/>
    <circle cx="5.5" cy="4" r="0.35" fill="#FFD700"/>
    <circle cx="3" cy="5.5" r="0.35" fill="#ff4444"/>
    <circle cx="5" cy="6" r="0.35" fill="#00aaff"/>
  </svg>`,

  rainbow: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
    <rect width="8" height="8" fill="#87CEEB"/>
    <path d="M0,8 Q4,-2 8,8" fill="none" stroke="#FF0000" stroke-width="1"/>
    <path d="M0.5,8 Q4,-1.2 7.5,8" fill="none" stroke="#FF7F00" stroke-width="0.8"/>
    <path d="M1,8 Q4,-0.5 7,8" fill="none" stroke="#FFFF00" stroke-width="0.8"/>
    <path d="M1.5,8 Q4,0.2 6.5,8" fill="none" stroke="#00CC00" stroke-width="0.8"/>
    <path d="M2,8 Q4,1 6,8" fill="none" stroke="#0000FF" stroke-width="0.8"/>
    <path d="M2.5,8 Q4,1.8 5.5,8" fill="none" stroke="#8B00FF" stroke-width="0.8"/>
    <ellipse cx="1.5" cy="7" rx="1.5" ry="1" fill="white"/>
    <ellipse cx="6.5" cy="7" rx="1.5" ry="1" fill="white"/>
  </svg>`,

  pacman: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
    <rect width="8" height="8" fill="#000000"/>
    <path d="M1,4 L3.5,2 A2.5,2.5 0 1,1 3.5,6 Z" fill="#FFD700"/>
    <circle cx="2.5" cy="2.2" r="0.35" fill="#000"/>
    <circle cx="5" cy="4" r="0.4" fill="#FFB8FF"/>
    <circle cx="6.5" cy="4" r="0.4" fill="#FFB8FF"/>
    <circle cx="5.75" cy="2.5" r="0.4" fill="#FFB8FF"/>
    <rect x="0" y="1" width="0.8" height="0.8" fill="#2121DE"/>
    <rect x="0" y="6.2" width="0.8" height="0.8" fill="#2121DE"/>
    <rect x="7" y="0" width="0.8" height="1.5" fill="#2121DE"/>
    <rect x="7" y="6.5" width="0.8" height="1.5" fill="#2121DE"/>
  </svg>`,

  mario: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
    <rect width="8" height="8" fill="#5C94FC"/>
    <rect x="2" y="1" width="4" height="1" fill="#AC3232"/>
    <rect x="1" y="2" width="6" height="1" fill="#AC3232"/>
    <rect x="1" y="3" width="2" height="1" fill="#F5C27B"/>
    <rect x="3" y="3" width="1" height="1" fill="#000"/>
    <rect x="4" y="3" width="2" height="1" fill="#F5C27B"/>
    <rect x="1" y="4" width="6" height="1" fill="#AC3232"/>
    <rect x="2" y="5" width="1" height="1" fill="#F5C27B"/>
    <rect x="3" y="5" width="2" height="1" fill="#AC3232"/>
    <rect x="5" y="5" width="1" height="1" fill="#F5C27B"/>
    <rect x="2" y="6" width="1" height="2" fill="#5C3317"/>
    <rect x="5" y="6" width="1" height="2" fill="#5C3317"/>
  </svg>`,

  pattern: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
    <rect width="8" height="8" fill="#0d0d2b"/>
    <rect x="0" y="0" width="2" height="2" fill="#ff006e"/>
    <rect x="2" y="0" width="2" height="2" fill="#8338ec"/>
    <rect x="4" y="0" width="2" height="2" fill="#3a86ff"/>
    <rect x="6" y="0" width="2" height="2" fill="#06d6a0"/>
    <rect x="1" y="2" width="2" height="2" fill="#fb5607"/>
    <rect x="3" y="2" width="2" height="2" fill="#ffbe0b"/>
    <rect x="5" y="2" width="2" height="2" fill="#ff006e"/>
    <rect x="0" y="4" width="2" height="2" fill="#3a86ff"/>
    <rect x="2" y="4" width="2" height="2" fill="#06d6a0"/>
    <rect x="4" y="4" width="2" height="2" fill="#8338ec"/>
    <rect x="6" y="4" width="2" height="2" fill="#fb5607"/>
    <rect x="1" y="6" width="2" height="2" fill="#ffbe0b"/>
    <rect x="3" y="6" width="2" height="2" fill="#ff006e"/>
    <rect x="5" y="6" width="2" height="2" fill="#3a86ff"/>
  </svg>`,
};

const svgToGrid = (svgString) => {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = GRID_WIDTH;
    canvas.height = GRID_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, GRID_WIDTH, GRID_HEIGHT);

    const imageData = ctx.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT);
    const d = imageData.data;

    let min = 255, max = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      min = Math.min(min, d[i*4], d[i*4+1], d[i*4+2]);
      max = Math.max(max, d[i*4], d[i*4+1], d[i*4+2]);
    }
    const range = max - min || 1;
    const stretch = (v) => Math.round((v - min) / range * 255);

    for (let i = 0; i < PIXEL_COUNT; i++) {
      const r = stretch(d[i*4]);
      const g = stretch(d[i*4+1]);
      const b = stretch(d[i*4+2]);
      colors[i] = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    URL.revokeObjectURL(url);
    render();
  };

  img.src = url;
};

const loadImageToGrid = (file) => {
  if (!file || !file.type.startsWith('image/')) return;

  const img = new Image();
  const url = URL.createObjectURL(file);

  img.onload = () => {
    const size = Math.min(img.width, img.height);
    const sx = (img.width - size) / 2;
    const sy = (img.height - size) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = GRID_WIDTH;
    canvas.height = GRID_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, size, size, 0, 0, GRID_WIDTH, GRID_HEIGHT);

    const imageData = ctx.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT);
    const d = imageData.data;

    let min = 255, max = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      min = Math.min(min, d[i*4], d[i*4+1], d[i*4+2]);
      max = Math.max(max, d[i*4], d[i*4+1], d[i*4+2]);
    }
    const range = max - min || 1;
    const stretch = (v) => Math.round((v - min) / range * 255);

    for (let i = 0; i < PIXEL_COUNT; i++) {
      const r = stretch(d[i*4]);
      const g = stretch(d[i*4+1]);
      const b = stretch(d[i*4+2]);
      colors[i] = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '00')}`;
    }

    URL.revokeObjectURL(url);
    render();
  };

  img.src = url;
};

importImageBtn.addEventListener('click', () => imageFileInput.click());
imageFileInput.addEventListener('change', (e) => loadImageToGrid(e.target.files?.[0]));

// Preset buttons
Object.entries(PRESETS).forEach(([name, svg]) => {
  const btn = document.querySelector(`#preset-${name}`);
  if (btn) btn.addEventListener('click', () => svgToGrid(svg));
});

const createGrid = () => {
  for (let i = 0; i < PIXEL_COUNT; i += 1) {
    const btn = document.createElement('button');
    btn.className = 'pixel';
    btn.type = 'button';
    btn.dataset.index = i;
    btn.addEventListener('mousedown', () => {
      isPainting = true;
      applyColor(i);
      render();
    });
    btn.addEventListener('mouseenter', () => {
      if (!isPainting) return;
      applyColor(i);
      render();
    });
    gridEl.append(btn);
  }

  document.addEventListener('mouseup', () => {
    isPainting = false;
  });
};

const setPaintMode = (mode) => {
  paintMode = mode;
  drawModeBtn.classList.toggle('active', mode === 'draw');
  eraseModeBtn.classList.toggle('active', mode === 'erase');
};

const createMicrobitAdapter = () => {
  // Use the ESM import from esm.sh: createWebUSBConnection
  if (typeof createWebUSBConnection === 'function') {
    return createWebUSBConnection();
  }
  return null;
};

const connectMicrobit = async (type) => {
  microbit = type === 'bluetooth'
    ? createWebBluetoothConnection()
    : createWebUSBConnection();

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
    setStatus('Connected via USB.');
  } catch (error) {
    debug(`USB connection error: ${error.message}`);
    setStatus(`USB connection failed (${error.message})`);
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
    setStatus('Connected via Bluetooth.');
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
  try {
    debug('Push button clicked');
    setStatus('uploading script to micro:bit…');
    await pushScript();
    setStatus('upload complete.');
  } catch (error) {
    debug(`Push error: ${error.message}`);
    setStatus(`upload failed (${error.message})`);
  }
});

drawModeBtn.addEventListener('click', () => setPaintMode('draw'));
eraseModeBtn.addEventListener('click', () => setPaintMode('erase'));

fillGridBtn.addEventListener('click', () => {
  colors.fill(colorInput.value);
  render();
});

clearGridBtn.addEventListener('click', () => {
  colors.fill('#000000');
  render();
});

createGrid();
render();
