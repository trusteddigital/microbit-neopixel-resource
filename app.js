const GRID_WIDTH = 8;
const GRID_HEIGHT = 8;
const PIXEL_COUNT = GRID_WIDTH * GRID_HEIGHT;

const gridEl = document.querySelector('#grid');
const colorInput = document.querySelector('#paint-color');
const drawModeBtn = document.querySelector('#draw-mode');
const eraseModeBtn = document.querySelector('#erase-mode');
const fillGridBtn = document.querySelector('#fill-grid');
const clearGridBtn = document.querySelector('#clear-grid');
const connectButton = document.querySelector('#connect-button');
const pushButton = document.querySelector('#push-button');
const statusEl = document.querySelector('#status');
const pythonPreviewEl = document.querySelector('#python-preview');

const colors = Array.from({ length: PIXEL_COUNT }, () => '#000000');
let paintMode = 'draw';
let isPainting = false;
let microbit = null;

const toRgbTuple = (hex) => {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
};

const toPython = () => {
  const tuples = colors.map((hex) => `(${toRgbTuple(hex).join(',')})`).join(', ');
  return [
    'from microbit import *',
    'import neopixel',
    '',
    `np = neopixel.NeoPixel(pin0, ${PIXEL_COUNT})`,
    `pixels = [${tuples}]`,
    '',
    'for i, value in enumerate(pixels):',
    '    np[i] = value',
    'np.show()',
    'display.show(Image.HAPPY)',
  ].join('\n');
};

const setStatus = (message) => {
  statusEl.textContent = `Status: ${message}`;
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
  const sdk = window.microbitConnection || window.microbit;
  if (!sdk) return null;

  if (typeof sdk.MicrobitConnection === 'function') {
    return new sdk.MicrobitConnection();
  }

  if (typeof sdk.createConnection === 'function') {
    return sdk.createConnection();
  }

  return sdk;
};

const connectMicrobit = async () => {
  microbit = createMicrobitAdapter();
  if (!microbit) {
    throw new Error('Could not find microbit-connection in the browser context.');
  }

  if (typeof microbit.requestMicrobit === 'function') {
    await microbit.requestMicrobit();
  } else if (typeof microbit.requestDevice === 'function') {
    await microbit.requestDevice();
  }

  if (typeof microbit.connect === 'function') {
    await microbit.connect();
  } else if (typeof microbit.open === 'function') {
    await microbit.open();
  }
};

const pushScript = async () => {
  const script = toPython();

  if (typeof microbit.flashScript === 'function') {
    await microbit.flashScript(script);
    return;
  }
  if (typeof microbit.writeScript === 'function') {
    await microbit.writeScript(script);
    return;
  }
  if (typeof microbit.write === 'function') {
    await microbit.write(script);
    return;
  }

  throw new Error('Connected, but no supported script upload method was found.');
};

connectButton.addEventListener('click', async () => {
  try {
    setStatus('connecting… approve the browser device prompt.');
    await connectMicrobit();
    pushButton.disabled = false;
    setStatus('connected to micro:bit.');
  } catch (error) {
    setStatus(`connection failed (${error.message})`);
  }
});

pushButton.addEventListener('click', async () => {
  try {
    setStatus('uploading script to micro:bit…');
    await pushScript();
    setStatus('upload complete.');
  } catch (error) {
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
