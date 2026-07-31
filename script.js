// ---------- DOM refs ----------
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const refreshBtn = document.getElementById('refreshBtn');
const resetBtn = document.getElementById('resetBtn');
const setCustomKeyBtn = document.getElementById('setCustomKeyBtn');
const customKeyInput = document.getElementById('customKeyInput');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const logDiv = document.getElementById('log');
const buttonGrid = document.getElementById('buttonGrid');
const keyboardDiv = document.getElementById('keyboard');
const socdAddBtn = document.getElementById('socdAddBtn');
const socdClearBtn = document.getElementById('socdClearBtn');
const socdList = document.getElementById('socdList');
const socdHint = document.getElementById('socdHint');

// ---------- State ----------
let port = null;
let reader = null;
let writer = null;
let keyData = [];
let selectedIndex = null;
let socdPairs = [];
let socdPicking = false;
let socdPickBuffer = [];
let heartbeatInterval = null;

// ---------- Logging ----------
function log(msg, isError = false) {
  const entry = document.createElement('div');
  entry.textContent = `> ${msg}`;
  if (isError) entry.style.color = '#f87171';
  logDiv.appendChild(entry);
  logDiv.scrollTop = logDiv.scrollHeight;
  const empty = logDiv.querySelector('.log-empty');
  if (empty) empty.remove();
}

// ---------- Helper ----------
function isInSocdPair(index) {
  return socdPairs.some(pair => pair.idx1 === index || pair.idx2 === index);
}

// ---------- UI ----------
function renderGrid() {
  buttonGrid.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const slot = document.createElement('div');
    let cls = 'btn-slot';
    if (selectedIndex === i) cls += ' selected';
    if (socdPicking && socdPickBuffer.includes(i)) cls += ' socd-picked';
    else if (socdPicking) cls += ' socd-pick';
    if (isInSocdPair(i)) cls += ' socd-active';
    
    slot.className = cls;
    slot.dataset.index = i;
    const pinMap = [7, 4, 6, 2, 5, 3];
    slot.innerHTML = `
      <span class="pin-label">Pin ${pinMap[i]}</span>
      <span class="key-label" id="keyLabel${i}">${keyData[i] || '—'}</span>
    `;
    slot.addEventListener('click', () => onSlotClick(i));
    buttonGrid.appendChild(slot);
  }
}

function onSlotClick(index) {
  if (socdPicking) {
    if (socdPickBuffer.includes(index)) {
      socdPickBuffer = socdPickBuffer.filter(i => i !== index);
      renderGrid();
      updateSocdHint();
      return;
    }
    if (socdPickBuffer.length < 2) {
      socdPickBuffer.push(index);
      renderGrid();
      updateSocdHint();
      if (socdPickBuffer.length === 2) {
        const [a, b] = socdPickBuffer;
        addSocdPair(a, b);
        socdPicking = false;
        socdPickBuffer = [];
        socdAddBtn.textContent = '➕ Add SOCD Pair';
        renderGrid();
        updateSocdHint();
      }
    }
    return;
  }

  if (selectedIndex === index) {
    selectedIndex = null;
  } else {
    selectedIndex = index;
  }
  renderGrid();
  updateKeyboardState();
  if (selectedIndex !== null) {
    log(`Selected Button ${selectedIndex+1} (Pin ${[7,4,6,2,5,3][selectedIndex]})`);
  } else {
    log('Deselected all buttons');
  }
}

function updateKeyLabel(index, keyName) {
  const label = document.getElementById(`keyLabel${index}`);
  if (label) label.textContent = keyName || '—';
}

function updateUI(connected) {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  refreshBtn.disabled = !connected;
  resetBtn.disabled = !connected;
  setCustomKeyBtn.disabled = !connected || selectedIndex === null;
  socdAddBtn.disabled = !connected;
  socdClearBtn.disabled = !connected || socdPairs.length === 0;
  statusDot.className = 'status-dot' + (connected ? ' connected' : '');
  statusText.textContent = connected ? 'Connected' : 'Disconnected';
  if (!connected && heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function updateKeyboardState() {
  const dimmed = selectedIndex === null;
  keyboardDiv.classList.toggle('dimmed', dimmed);
  const hint = document.querySelector('.keyboard-hint');
  if (hint) {
    hint.textContent = dimmed
      ? 'Click a button above to select it, then click a key to assign.'
      : `Selected Button ${selectedIndex+1} – click any key to assign.`;
  }
  setCustomKeyBtn.disabled = dimmed || !writer;
}

function updateSocdHint() {
  if (socdPicking) {
    if (socdPickBuffer.length === 0) {
      socdHint.textContent = 'Click two buttons to create a new SOCD pair.';
    } else if (socdPickBuffer.length === 1) {
      socdHint.textContent = `Selected Button ${socdPickBuffer[0]+1}. Now pick the second.`;
    } else {
      socdHint.textContent = 'Pair ready – sending…';
    }
  } else {
    if (socdPairs.length >= 2) {
      socdHint.textContent = '⚠️ Maximum 2 SOCD profiles reached.';
    } else {
      socdHint.textContent = '';
    }
  }
}

function renderSocdList() {
  socdList.innerHTML = '';
  if (socdPairs.length === 0) {
    socdList.innerHTML = '<span style="color:#94a3b8; font-size:0.9rem;">No SOCD pairs</span>';
    return;
  }
  socdPairs.forEach((pair, idx) => {
    const el = document.createElement('span');
    el.className = 'socd-pair';
    el.innerHTML = `
      Button ${pair.idx1+1} ↔ ${pair.idx2+1}
      <button class="remove-pair" data-index="${idx}">✕</button>
    `;
    el.querySelector('.remove-pair').addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(e.target.dataset.index);
      removeSocdPair(i);
    });
    socdList.appendChild(el);
  });
  updateSocdHint();
}

// ---------- Serial ----------
async function sendCommand(cmd) {
  if (!writer) throw new Error('No writer');
  try {
    await writer.write(new TextEncoder().encode(cmd + '\n'));
    log(`TX: ${cmd}`);
  } catch (e) {
    log(`Write error: ${e.message}`, true);
    await disconnect();
    throw e;
  }
}

async function readUntil(predicate, timeoutMs = 3000) {
  if (!reader) throw new Error('No reader');
  let buffer = '';
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      const { value, done } = await reader.read();
      if (done) {
        // Port closed – return null, let caller decide
        return null;
      }
      const chunk = new TextDecoder().decode(value);
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) log(`RX: ${trimmed}`);
        if (predicate(trimmed)) return trimmed;
      }
    }
    return null;
  } catch (e) {
    log(`Read error: ${e.message}`, true);
    return null; // don't disconnect here, let caller handle
  }
}

// ---------- Heartbeat ----------
async function checkConnection() {
  if (!writer) return false;
  try {
    await sendCommand('PING');
    const resp = await readUntil(line => line === 'PONG', 1000);
    if (resp === 'PONG') return true;
    await disconnect();
    return false;
  } catch (e) {
    await disconnect();
    return false;
  }
}

// ---------- Fetch Keys ----------
async function fetchAllKeys() {
  if (!writer) return;
  await sendCommand('GETALL');
  let received = [];
  let buffer = '';
  let done = false;
  const start = Date.now();
  while (!done && (Date.now() - start < 3000)) {
    const { value, done: doneRead } = await reader.read();
    if (doneRead) return;
    const chunk = new TextDecoder().decode(value);
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      log(`RX: ${trimmed}`);
      if (trimmed === 'END') { done = true; break; }
      if (trimmed.startsWith('KEY')) {
        const parts = trimmed.split(':');
        if (parts.length === 2) {
          const idx = parseInt(parts[0].replace('KEY', '')) - 1;
          received[idx] = parts[1];
        }
      }
    }
  }
  keyData = received.map(v => v || '');
  renderGrid();
  log(`Fetched ${keyData.length} key mappings`);
}

// ---------- Fetch SOCD ----------
async function fetchSocd() {
  if (!writer) return;
  await sendCommand('GETSOCD');
  const resp = await readUntil(line => line.startsWith('SOCD:'), 1500);
  if (resp) {
    socdPairs = [];
    if (resp !== 'SOCD:OFF') {
      const pairsStr = resp.substring(5);
      const parts = pairsStr.split(';');
      for (const part of parts) {
        const [a, b] = part.split(',').map(Number);
        if (!isNaN(a) && !isNaN(b) && a >= 1 && a <= 6 && b >= 1 && b <= 6 && a !== b) {
          socdPairs.push({ idx1: a-1, idx2: b-1 });
        }
      }
    }
    renderSocdList();
    renderGrid();
    updateUI(true);
    updateSocdHint();
  } else {
    log('Failed to get SOCD status', true);
  }
}

// ---------- SOCD Actions ----------
async function addSocdPair(idx1, idx2) {
  if (!writer) return;
  if (socdPairs.length >= 2) {
    const msg = 'Maximum 2 SOCD profiles reached.';
    log(msg, true);
    socdHint.textContent = '⚠️ ' + msg;
    return;
  }
  await sendCommand(`SOCD ADD ${idx1+1} ${idx2+1}`);
  // Read until we see a line that starts with "OK" or "ERROR"
  const resp = await readUntil(line => line.startsWith('OK') || line.startsWith('ERROR'), 2000);
  if (resp && resp.startsWith('OK')) {
    log(`Added SOCD pair: Button ${idx1+1} ↔ ${idx2+1}`);
    await fetchSocd();
  } else if (resp && resp.startsWith('ERROR')) {
    log(`Failed to add SOCD pair: ${resp}`, true);
  } else {
    // No response or malformed – but the firmware might have saved it anyway.
    // Re-fetch SOCD status to be sure.
    log('No clear response – refreshing SOCD status', false);
    await fetchSocd();
  }
}

async function removeSocdPair(index) {
  if (!writer) return;
  await sendCommand(`SOCD REMOVE ${index+1}`);
  const resp = await readUntil(line => line.startsWith('OK') || line.startsWith('ERROR'), 2000);
  if (resp && resp.startsWith('OK')) {
    log(`Removed SOCD pair ${index+1}`);
    await fetchSocd();
  } else if (resp && resp.startsWith('ERROR')) {
    log(`Failed to remove SOCD pair: ${resp}`, true);
  } else {
    log('No clear response – refreshing SOCD status', false);
    await fetchSocd();
  }
}

async function clearAllSocd() {
  if (!writer) return;
  await sendCommand('SOCD CLEAR');
  const resp = await readUntil(line => line.startsWith('OK') || line.startsWith('ERROR'), 2000);
  if (resp && resp.startsWith('OK')) {
    log('Cleared all SOCD pairs');
    await fetchSocd();
  } else if (resp && resp.startsWith('ERROR')) {
    log(`Failed to clear SOCD: ${resp}`, true);
  } else {
    log('No clear response – refreshing SOCD status', false);
    await fetchSocd();
  }
}

// ---------- Key Assignment ----------
async function assignKey(index, keyName) {
  if (index < 0 || index > 5) return false;
  if (!writer) return false;
  if (keyName === keyData[index]) {
    log(`Key for Button ${index+1} is already "${keyName}"`);
    return true;
  }
  await sendCommand(`SETKEY${index+1}:${keyName}`);
  const resp = await readUntil(line => line === 'OK', 1500);
  if (resp === 'OK') {
    keyData[index] = keyName;
    updateKeyLabel(index, keyName);
    log(`Assigned "${keyName}" to Button ${index+1}`);
    return true;
  } else {
    log(`Failed to assign "${keyName}" to Button ${index+1}`, true);
    return false;
  }
}

// ---------- Reset ----------
async function resetToDefaults() {
  if (!writer) return;
  if (!confirm('Reset all keys to defaults (q,w,e,a,s,d) and clear SOCD pairs?')) return;
  await sendCommand('RESET');
  const resp = await readUntil(line => line === 'OK RESET', 2000);
  if (resp) {
    log('Reset to defaults');
    await fetchAllKeys();
    await fetchSocd();
  } else {
    log('Reset timed out', true);
  }
}

// ---------- Connect / Disconnect ----------
async function connect() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    writer = port.writable.getWriter();
    reader = port.readable.getReader();
    updateUI(true);
    log('Connected to Arduino');
    await new Promise(r => setTimeout(r, 50));
    await fetchAllKeys();
    await fetchSocd();
    selectedIndex = null;
    renderGrid();
    updateKeyboardState();
    updateUI(true);
    updateSocdHint();

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async () => {
      if (!writer) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        return;
      }
      const ok = await checkConnection();
      if (!ok) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    }, 3000);
  } catch (e) {
    log(`Connection error: ${e.message}`, true);
    await disconnect();
  }
}

async function disconnect() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  try {
    if (reader) {
      await reader.cancel();
      reader = null;
    }
    if (writer) {
      await writer.close();
      writer = null;
    }
    if (port) {
      await port.close();
      port = null;
    }
  } catch (e) { /* ignore */ }
  keyData = [];
  selectedIndex = null;
  socdPairs = [];
  socdPicking = false;
  socdPickBuffer = [];
  renderGrid();
  updateKeyboardState();
  renderSocdList();
  updateUI(false);
  updateSocdHint();
  log('Disconnected');
}

// ---------- Build Keyboard ----------
function buildKeyboard() {
  const rows = [
    [
      { label: 'Esc', value: 'ESC' },
      { label: 'F1', value: 'F1' }, { label: 'F2', value: 'F2' }, { label: 'F3', value: 'F3' },
      { label: 'F4', value: 'F4' }, { label: 'F5', value: 'F5' }, { label: 'F6', value: 'F6' },
      { label: 'F7', value: 'F7' }, { label: 'F8', value: 'F8' }, { label: 'F9', value: 'F9' },
      { label: 'F10', value: 'F10' }, { label: 'F11', value: 'F11' }, { label: 'F12', value: 'F12' },
    ],
    [
      { label: '`', value: '`' }, { label: '~', value: '~' },
      { label: '!', value: '!' }, { label: '@', value: '@' }, { label: '#', value: '#' },
      { label: '$', value: '$' }, { label: '%', value: '%' }, { label: '^', value: '^' },
      { label: '&', value: '&' }, { label: '*', value: '*' }, { label: '(', value: '(' },
      { label: ')', value: ')' }, { label: '_', value: '_' }, { label: '+', value: '+' },
      { label: '{', value: '{' }, { label: '}', value: '}' }, { label: '|', value: '|' },
      { label: ':', value: ':' }, { label: '"', value: '"' }, { label: '<', value: '<' },
      { label: '>', value: '>' }, { label: '?', value: '?' },
    ],
    [
      { label: '`', value: '`' }, { label: '1', value: '1' }, { label: '2', value: '2' },
      { label: '3', value: '3' }, { label: '4', value: '4' }, { label: '5', value: '5' },
      { label: '6', value: '6' }, { label: '7', value: '7' }, { label: '8', value: '8' },
      { label: '9', value: '9' }, { label: '0', value: '0' }, { label: '-', value: '-' },
      { label: '=', value: '=' }, { label: '⌫', value: 'BACK', className: 'wide' },
    ],
    [
      { label: 'Tab', value: 'TAB', className: 'wide' },
      { label: 'Q', value: 'q' }, { label: 'W', value: 'w' }, { label: 'E', value: 'e' },
      { label: 'R', value: 'r' }, { label: 'T', value: 't' }, { label: 'Y', value: 'y' },
      { label: 'U', value: 'u' }, { label: 'I', value: 'i' }, { label: 'O', value: 'o' },
      { label: 'P', value: 'p' }, { label: '[', value: '[' }, { label: ']', value: ']' },
      { label: '\\', value: '\\' },
    ],
    [
      { label: 'Caps', value: 'CAPS', className: 'wider' },
      { label: 'A', value: 'a' }, { label: 'S', value: 's' }, { label: 'D', value: 'd' },
      { label: 'F', value: 'f' }, { label: 'G', value: 'g' }, { label: 'H', value: 'h' },
      { label: 'J', value: 'j' }, { label: 'K', value: 'k' }, { label: 'L', value: 'l' },
      { label: ';', value: ';' }, { label: "'", value: "'" }, { label: 'Enter', value: 'ENTER', className: 'wide' },
    ],
    [
      { label: 'Shift', value: 'LSHIFT', className: 'wider' },
      { label: 'Z', value: 'z' }, { label: 'X', value: 'x' }, { label: 'C', value: 'c' },
      { label: 'V', value: 'v' }, { label: 'B', value: 'b' }, { label: 'N', value: 'n' },
      { label: 'M', value: 'm' }, { label: ',', value: ',' }, { label: '.', value: '.' },
      { label: '/', value: '/' }, { label: 'Shift', value: 'RSHIFT', className: 'wider' },
    ],
    [
      { label: 'Ctrl', value: 'LCTRL', className: 'wide' },
      { label: 'Win', value: 'LGUI', className: 'wide' },
      { label: 'Alt', value: 'LALT', className: 'wide' },
      { label: 'Space', value: 'SPACE', className: 'space' },
      { label: 'Alt', value: 'RALT', className: 'wide' },
      { label: 'Win', value: 'RGUI', className: 'wide' },
      { label: 'Ctrl', value: 'RCTRL', className: 'wide' },
      { label: '←', value: 'LEFT', className: 'wide' },
      { label: '↓', value: 'DOWN', className: 'wide' },
      { label: '→', value: 'RIGHT', className: 'wide' },
      { label: '↑', value: 'UP', className: 'wide' },
    ],
    [
      { label: 'Ins', value: 'INS' }, { label: 'Home', value: 'HOME' },
      { label: 'PgUp', value: 'PGUP' }, { label: 'Del', value: 'DEL' },
      { label: 'End', value: 'END' }, { label: 'PgDn', value: 'PGDN' },
      { label: 'PrtSc', value: 'PRTSC' }, { label: 'ScrLk', value: 'SCRLK' },
      { label: 'Pause', value: 'PAUSE' }, { label: 'NumLk', value: 'NUMLK' },
    ],
  ];

  keyboardDiv.innerHTML = '';
  for (const row of rows) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'key-row';
    for (const key of row) {
      const el = document.createElement('div');
      el.className = 'key' + (key.className ? ' ' + key.className : '');
      el.textContent = key.label;
      el.dataset.value = key.value;
      el.addEventListener('click', () => onKeyClick(key.value));
      rowDiv.appendChild(el);
    }
    keyboardDiv.appendChild(rowDiv);
  }
}

// ---------- Key Click ----------
async function onKeyClick(value) {
  if (selectedIndex === null) {
    log('Please select a button first (click one of the 6 squares)');
    return;
  }
  if (!writer) {
    log('Not connected to Arduino');
    return;
  }
  await assignKey(selectedIndex, value);
}

// ---------- Custom Key ----------
async function setCustomKey() {
  if (selectedIndex === null) {
    log('Select a button first');
    return;
  }
  const val = customKeyInput.value.trim();
  if (!val) {
    log('Enter a key name');
    return;
  }
  await assignKey(selectedIndex, val);
  customKeyInput.value = '';
}

// ---------- SOCD Toggle ----------
function toggleSocdPicking() {
  if (!writer) {
    log('Not connected to Arduino');
    return;
  }
  if (socdPairs.length >= 2) {
    const msg = 'Maximum 2 SOCD profiles reached.';
    log(msg, true);
    socdHint.textContent = '⚠️ ' + msg;
    return;
  }
  if (socdPicking) {
    socdPicking = false;
    socdPickBuffer = [];
    socdAddBtn.textContent = '➕ Add SOCD Pair';
    renderGrid();
    updateSocdHint();
    return;
  }
  socdPicking = true;
  socdPickBuffer = [];
  socdAddBtn.textContent = '❌ Cancel';
  renderGrid();
  updateSocdHint();
  log('SOCD pairing mode: click two buttons to create a new pair.');
}

// ---------- Events ----------
connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
refreshBtn.addEventListener('click', async () => {
  if (writer) {
    await fetchAllKeys();
    await fetchSocd();
  }
});
resetBtn.addEventListener('click', resetToDefaults);
setCustomKeyBtn.addEventListener('click', setCustomKey);
customKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') setCustomKey(); });
socdAddBtn.addEventListener('click', toggleSocdPicking);
socdClearBtn.addEventListener('click', async () => {
  if (writer) {
    if (confirm('Remove all SOCD pairs?')) {
      await clearAllSocd();
    }
  }
});

// ---------- Init ----------
buildKeyboard();
updateUI(false);
updateKeyboardState();
renderSocdList();
updateSocdHint();
if (!('serial' in navigator)) {
  log('❌ Web Serial API not supported. Use Chrome/Edge.', true);
  connectBtn.disabled = true;
}