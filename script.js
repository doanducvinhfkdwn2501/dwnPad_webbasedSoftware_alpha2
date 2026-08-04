// ---------- DOM refs ----------
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const refreshBtn = document.getElementById('refreshBtn');
const resetBtn = document.getElementById('resetBtn');
const pressKeyDisplay = document.getElementById('pressKeyDisplay');
const dualPressDisplay = document.getElementById('dualPressDisplay');
const dualReleaseDisplay = document.getElementById('dualReleaseDisplay');
const modeRadios = document.querySelectorAll('input[name="mode"]');
const keyControls = document.getElementById('keyControls');
const dualControls = document.getElementById('dualControls');
const macroControls = document.getElementById('macroControls');
const macroStepsDiv = document.getElementById('macroSteps');
const addStepBtn = document.getElementById('addStepBtn');
const clearMacroBtn = document.getElementById('clearMacroBtn');
const applyMacroBtn = document.getElementById('applyMacroBtn');
const copyPressToReleaseBtn = document.getElementById('copyPressToReleaseBtn');
const applyDualBtn = document.getElementById('applyDualBtn');
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
let pressKeys = [];
let releaseKeys = [];
let modes = [];
let selectedIndex = null;
let socdPairs = [];
let socdPicking = false;
let socdPickBuffer = [];
let heartbeatInterval = null;
let busy = false;
let dualTarget = 'press';
let macroData = []; // array of { steps: [ { action, key, delay } ] }
let selectedStepIndex = null;

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

function getDisplayLabel(idx) {
  if (modes[idx] === 1) {
    return `${pressKeys[idx] || '?'} → ${releaseKeys[idx] || '?'}`;
  } else if (modes[idx] === 2) {
    const steps = macroData[idx]?.steps || [];
    if (steps.length === 0) return 'M: ∅';
    const labels = steps.map(step => {
      if (step.action === 'D') return `⏱${step.delay}`;
      return step.key || '?';
    });
    return `M: ${labels.join(' ')}`;
  }
  return pressKeys[idx] || '—';
}

// ---------- renderSocdList (FIXED - moved before use) ----------
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
    if (modes[i] === 1) cls += ' dual-mode';
    if (modes[i] === 2) cls += ' macro-mode';
    slot.className = cls;
    slot.dataset.index = i;
    const pinMap = [7, 4, 6, 2, 5, 3];
    const label = getDisplayLabel(i);
    slot.innerHTML = `
      <span class="pin-label">Pin ${pinMap[i]}</span>
      <span class="key-label" id="keyLabel${i}">${label}</span>
    `;
    slot.addEventListener('click', () => onSlotClick(i));
    buttonGrid.appendChild(slot);
  }
}

function updateDisplays() {
  if (selectedIndex === null) {
    pressKeyDisplay.textContent = '—';
    dualPressDisplay.textContent = '—';
    dualReleaseDisplay.textContent = '—';
    return;
  }
  const mode = modes[selectedIndex] || 0;
  if (mode === 0) {
    pressKeyDisplay.textContent = pressKeys[selectedIndex] || '—';
  } else if (mode === 1) {
    dualPressDisplay.textContent = pressKeys[selectedIndex] || '—';
    dualReleaseDisplay.textContent = releaseKeys[selectedIndex] || '—';
  }
  document.querySelectorAll('.dual-slot').forEach(el => {
    el.classList.toggle('active-slot', el.dataset.slot === dualTarget);
  });
  if (mode === 2 && selectedIndex !== null) {
    renderMacroEditor(selectedIndex);
  }
}

function updateModeSectionState() {
  const modeSection = document.querySelector('.mode-section');
  if (modeSection) {
    modeSection.classList.toggle('disabled', selectedIndex === null);
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
        updateSocdHint();
      }
    }
    return;
  }

  if (selectedIndex === index) {
    selectedIndex = null;
    selectedStepIndex = null;
  } else {
    selectedIndex = index;
    selectedStepIndex = null;
    if (!macroData[selectedIndex]) macroData[selectedIndex] = { steps: [] };
  }
  renderGrid();
  updateControls();
  updateModeSectionState();
  if (selectedIndex !== null) {
    log(`Selected Button ${selectedIndex+1} (Pin ${[7,4,6,2,5,3][selectedIndex]})`);
    const mode = modes[selectedIndex] || 0;
    document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
    toggleModeControls(mode);
    updateDisplays();
  } else {
    log('Deselected all buttons');
    updateDisplays();
  }
}

function updateKeyLabel(index) {
  const label = document.getElementById(`keyLabel${index}`);
  if (label) label.textContent = getDisplayLabel(index);
}

function updateUI() {
  const connected = !!writer && !busy;
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  refreshBtn.disabled = !connected || busy;
  resetBtn.disabled = !connected || busy;
  applyDualBtn.disabled = !connected || selectedIndex === null || busy;
  copyPressToReleaseBtn.disabled = !connected || selectedIndex === null || busy;
  applyMacroBtn.disabled = !connected || selectedIndex === null || busy || modes[selectedIndex] !== 2;
  addStepBtn.disabled = !connected || selectedIndex === null || busy || modes[selectedIndex] !== 2;
  clearMacroBtn.disabled = !connected || selectedIndex === null || busy || modes[selectedIndex] !== 2;
  socdAddBtn.disabled = !connected || busy;
  socdClearBtn.disabled = !connected || socdPairs.length === 0 || busy;
  statusDot.className = 'status-dot' + (connected ? ' connected' : '');
  statusText.textContent = connected ? 'Connected' : 'Disconnected';
  if (!connected && heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  updateModeSectionState();
}

function updateControls() {
  const dimmed = selectedIndex === null || busy;
  keyboardDiv.classList.toggle('dimmed', dimmed);
  const hint = document.querySelector('.keyboard-hint');
  if (hint) {
    let modeText = '';
    if (selectedIndex !== null) {
      const mode = modes[selectedIndex] || 0;
      if (mode === 0) modeText = 'Key mode – click a key to assign it.';
      else if (mode === 1) modeText = 'Dual mode – select a slot (Press/Release) then click a key.';
      else if (mode === 2) modeText = 'Macro mode – click a step\'s key display to select it, then click a key to assign.';
    }
    hint.textContent = dimmed
      ? 'Click a button above to select it.'
      : `Selected Button ${selectedIndex+1} – ${modeText}`;
  }
  applyDualBtn.disabled = dimmed || !writer;
  copyPressToReleaseBtn.disabled = dimmed || !writer;
  applyMacroBtn.disabled = dimmed || !writer || (selectedIndex !== null && modes[selectedIndex] !== 2);
  addStepBtn.disabled = dimmed || !writer || (selectedIndex !== null && modes[selectedIndex] !== 2);
  clearMacroBtn.disabled = dimmed || !writer || (selectedIndex !== null && modes[selectedIndex] !== 2);
  updateModeSectionState();
}

function toggleModeControls(mode) {
  keyControls.style.display = 'none';
  dualControls.style.display = 'none';
  macroControls.style.display = 'none';
  if (mode === 1) {
    dualControls.style.display = 'block';
    dualTarget = 'press';
    updateDisplays();
  } else if (mode === 2) {
    macroControls.style.display = 'block';
    if (selectedIndex !== null) {
      renderMacroEditor(selectedIndex);
    }
  } else {
    keyControls.style.display = 'flex';
    updateDisplays();
  }
  updateDisplays();
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

// ---------- Macro Editor ----------
function renderMacroEditor(buttonIdx) {
  if (!macroStepsDiv) return;
  if (!macroData[buttonIdx]) macroData[buttonIdx] = { steps: [] };
  const steps = macroData[buttonIdx].steps || [];
  if (steps.length === 0) {
    macroStepsDiv.innerHTML = '<div style="color:#94a3b8; font-size:0.9rem; text-align:center; padding:0.5rem;">No steps – click "Add Step"</div>';
    return;
  }
  let html = '';
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isSelected = (selectedStepIndex === i);
    const keyDisplay = step.key || '—';
    const delayDisplay = step.delay || 0;
    const actions = ['P', 'R', 'B', 'D'];
    const actionLabels = ['Press', 'Release', 'Both', 'Delay'];
    let actionOptions = actions.map((a, idx) =>
      `<option value="${a}" ${step.action === a ? 'selected' : ''}>${actionLabels[idx]}</option>`
    ).join('');
    html += `
      <div class="macro-step ${isSelected ? 'selected' : ''}" data-step-index="${i}">
        <span class="step-index">${i+1}.</span>
        <select class="step-action" data-index="${i}">
          ${actionOptions}
        </select>
        <span class="step-key ${isSelected ? 'active-step-key' : ''}" data-step="${i}">${keyDisplay}</span>
        <input type="number" class="step-delay" data-index="${i}" value="${delayDisplay}" min="0" max="5000" placeholder="ms" style="${step.action !== 'D' ? 'display:none;' : ''}">
        <button class="remove-step" data-index="${i}">✕</button>
      </div>
    `;
  }
  macroStepsDiv.innerHTML = html;

  // Event listeners
  macroStepsDiv.querySelectorAll('.step-key').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.step);
      if (!isNaN(idx)) {
        selectedStepIndex = idx;
        renderMacroEditor(selectedIndex);
        log(`Selected step ${idx+1} for key assignment.`);
      }
    });
  });

  macroStepsDiv.querySelectorAll('.remove-step').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.index);
      if (!isNaN(idx)) {
        removeStep(selectedIndex, idx);
      }
    });
  });

  macroStepsDiv.querySelectorAll('.step-action').forEach(el => {
    el.addEventListener('change', (e) => {
      const idx = parseInt(el.dataset.index);
      const newAction = el.value;
      if (!isNaN(idx) && selectedIndex !== null) {
        macroData[selectedIndex].steps[idx].action = newAction;
        const delayInput = macroStepsDiv.querySelector(`.step-delay[data-index="${idx}"]`);
        if (delayInput) {
          delayInput.style.display = (newAction === 'D') ? 'inline-block' : 'none';
        }
        updateKeyLabel(selectedIndex);
      }
    });
  });

  macroStepsDiv.querySelectorAll('.step-delay').forEach(el => {
    el.addEventListener('change', (e) => {
      const idx = parseInt(el.dataset.index);
      const val = parseInt(el.value) || 0;
      if (!isNaN(idx) && selectedIndex !== null) {
        macroData[selectedIndex].steps[idx].delay = Math.min(val, 5000);
        updateKeyLabel(selectedIndex);
      }
    });
  });

  updateUI();
  updateControls();
}

function addStep() {
  if (selectedIndex === null) return;
  if (!macroData[selectedIndex]) macroData[selectedIndex] = { steps: [] };
  macroData[selectedIndex].steps.push({ action: 'P', key: '', delay: 0 });
  selectedStepIndex = macroData[selectedIndex].steps.length - 1;
  renderMacroEditor(selectedIndex);
  updateKeyLabel(selectedIndex);
  log(`Added step ${selectedStepIndex+1}`);
}

function removeStep(buttonIdx, stepIdx) {
  if (buttonIdx === null || buttonIdx === undefined) return;
  if (!macroData[buttonIdx]) return;
  macroData[buttonIdx].steps.splice(stepIdx, 1);
  if (selectedStepIndex === stepIdx) selectedStepIndex = null;
  else if (selectedStepIndex > stepIdx) selectedStepIndex--;
  renderMacroEditor(buttonIdx);
  updateKeyLabel(buttonIdx);
  log(`Removed step ${stepIdx+1}`);
}

function clearMacro() {
  if (selectedIndex === null) return;
  if (!macroData[selectedIndex]) return;
  macroData[selectedIndex].steps = [];
  selectedStepIndex = null;
  renderMacroEditor(selectedIndex);
  updateKeyLabel(selectedIndex);
  log('Cleared macro');
}

async function applyMacro() {
  if (selectedIndex === null) return;
  if (!writer || busy) { log('Not connected or busy'); return; }
  const steps = macroData[selectedIndex]?.steps || [];
  if (steps.length === 0) {
    log('Macro is empty – nothing to save.');
    return;
  }
  const parts = [];
  for (const step of steps) {
    if (step.action === 'D') {
      parts.push(`D:${step.delay || 0}`);
    } else {
      const key = step.key || '';
      if (!key) {
        log('Step has no key assigned – skipping.', true);
        continue;
      }
      parts.push(`${step.action}:${key}`);
    }
  }
  if (parts.length === 0) {
    log('No valid steps to save.', true);
    return;
  }
  const macroStr = parts.join(',');
  await sendCommand(`SETMACRO ${selectedIndex+1}:${macroStr}`);
  const resp = await readUntil(line => line === 'OK', 2000);
  if (resp === 'OK') {
    log(`Macro saved for Button ${selectedIndex+1}`);
    if (modes[selectedIndex] !== 2) {
      await setMode(selectedIndex, 2);
    }
    updateKeyLabel(selectedIndex);
  } else {
    log('Failed to save macro.', true);
  }
}

// ---------- SOCD removal ----------
function removeSocdPairByButton(buttonIndex) {
  let pairIndex = -1;
  for (let i = 0; i < socdPairs.length; i++) {
    if (socdPairs[i].idx1 === buttonIndex || socdPairs[i].idx2 === buttonIndex) {
      pairIndex = i;
      break;
    }
  }
  if (pairIndex !== -1) {
    socdPairs.splice(pairIndex, 1);
    renderSocdList();
    renderGrid();
    updateUI();
    updateSocdHint();
    log(`SOCD pair removed because button ${buttonIndex+1} switched to Dual/Macro mode.`);
  }
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
        await disconnect();
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
    if (writer) await disconnect();
    return null;
  } catch (e) {
    log(`Read error: ${e.message}`, true);
    await disconnect();
    return null;
  }
}

// ---------- Heartbeat ----------
async function checkConnection() {
  if (busy) return true;
  if (!writer) { await disconnect(); return false; }
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

// ---------- Fetch all data ----------
async function fetchAllData() {
  if (!writer || busy) return;
  busy = true;
  updateUI();
  try {
    // Fetch press keys
    await sendCommand('GETPRESSALL');
    let receivedPress = [];
    let buffer = '';
    let done = false;
    const start = Date.now();
    while (!done && (Date.now() - start < 3000)) {
      const { value, done: doneRead } = await reader.read();
      if (doneRead) { await disconnect(); return; }
      const chunk = new TextDecoder().decode(value);
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        log(`RX: ${trimmed}`);
        if (trimmed === 'END') { done = true; break; }
        if (trimmed.startsWith('PRESS')) {
          const parts = trimmed.split(':');
          if (parts.length === 2) {
            const idx = parseInt(parts[0].replace('PRESS', '')) - 1;
            receivedPress[idx] = parts[1];
          }
        }
      }
    }
    // Fetch release keys
    await sendCommand('GETRELEASEALL');
    let receivedRelease = [];
    buffer = '';
    done = false;
    const start2 = Date.now();
    while (!done && (Date.now() - start2 < 3000)) {
      const { value, done: doneRead } = await reader.read();
      if (doneRead) { await disconnect(); return; }
      const chunk = new TextDecoder().decode(value);
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        log(`RX: ${trimmed}`);
        if (trimmed === 'END') { done = true; break; }
        if (trimmed.startsWith('RELEASE')) {
          const parts = trimmed.split(':');
          if (parts.length === 2) {
            const idx = parseInt(parts[0].replace('RELEASE', '')) - 1;
            receivedRelease[idx] = parts[1];
          }
        }
      }
    }
    // Fetch modes
    await sendCommand('GETMODEALL');
    let receivedModes = [];
    buffer = '';
    done = false;
    const start3 = Date.now();
    while (!done && (Date.now() - start3 < 3000)) {
      const { value, done: doneRead } = await reader.read();
      if (doneRead) { await disconnect(); return; }
      const chunk = new TextDecoder().decode(value);
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        log(`RX: ${trimmed}`);
        if (trimmed === 'END') { done = true; break; }
        if (trimmed.startsWith('MODE')) {
          const parts = trimmed.split(':');
          if (parts.length === 2) {
            const idx = parseInt(parts[0].replace('MODE', '')) - 1;
            receivedModes[idx] = parseInt(parts[1]);
          }
        }
      }
    }
    pressKeys = receivedPress.map(v => v || '');
    releaseKeys = receivedRelease.map(v => v || '');
    modes = receivedModes.map(v => (v !== undefined) ? v : 0);
    // Fetch macros
    await fetchMacros();
    renderGrid();
    updateDisplays();
    updateModeSectionState();
    log('Fetched all data');
  } catch (e) {
    log(`Fetch data error: ${e.message}`, true);
  } finally {
    busy = false;
    updateUI();
  }
}

// ---------- Fetch macros ----------
async function fetchMacros() {
  if (!writer) return;
  try {
    await sendCommand('GETMACROALL');
    let buffer = '';
    let done = false;
    const start = Date.now();
    while (!done && (Date.now() - start < 3000)) {
      const { value, done: doneRead } = await reader.read();
      if (doneRead) { await disconnect(); return; }
      const chunk = new TextDecoder().decode(value);
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        log(`RX: ${trimmed}`);
        if (trimmed === 'END') { done = true; break; }
        if (trimmed.startsWith('MACRO')) {
          const parts = trimmed.split(':');
          if (parts.length === 2) {
            const idx = parseInt(parts[0].replace('MACRO', '')) - 1;
            const macroStr = parts[1];
            const steps = [];
            if (macroStr && macroStr.length > 0) {
              const tokens = macroStr.split(',');
              for (const token of tokens) {
                const colon = token.indexOf(':');
                if (colon > 0) {
                  const action = token.substring(0, colon);
                  const value = token.substring(colon+1);
                  if (action === 'D') {
                    steps.push({ action: 'D', key: '', delay: parseInt(value) || 0 });
                  } else if (['P','R','B'].includes(action)) {
                    steps.push({ action, key: value, delay: 0 });
                  }
                }
              }
            }
            macroData[idx] = { steps };
          }
        }
      }
    }
    for (let i = 0; i < 6; i++) {
      if (!macroData[i]) macroData[i] = { steps: [] };
    }
  } catch (e) {
    log(`Fetch macros error: ${e.message}`, true);
  }
}

// ---------- Fetch SOCD ----------
async function fetchSocd() {
  if (!writer || busy) return;
  busy = true;
  updateUI();
  try {
    await sendCommand('GETSOCD');
    await new Promise(r => setTimeout(r, 50));
    const resp = await readUntil(line => line.startsWith('SOCD:'), 1500);
    if (resp === null) return;
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
      updateUI();
      updateSocdHint();
    } else {
      log('Failed to get SOCD status', true);
    }
  } catch (e) {
    log(`Fetch SOCD error: ${e.message}`, true);
  } finally {
    busy = false;
    updateUI();
  }
}

// ---------- SOCD Actions ----------
async function addSocdPair(idx1, idx2) {
  if (!writer || busy) return;
  if (socdPairs.length >= 2) {
    const msg = 'Maximum 2 SOCD profiles reached.';
    log(msg, true);
    socdHint.textContent = '⚠️ ' + msg;
    return;
  }
  if (isInSocdPair(idx1) || isInSocdPair(idx2)) {
    log('One of these buttons is already in a SOCD pair', true);
    return;
  }
  busy = true;
  updateUI();
  try {
    await sendCommand(`SOCD ADD ${idx1+1} ${idx2+1}`);
    await new Promise(r => setTimeout(r, 50));
    const resp = await readUntil(line => line.startsWith('OK') || line.startsWith('ERROR'), 2000);
    if (resp === null) return;
    if (resp && resp.startsWith('OK')) {
      socdPairs.push({ idx1, idx2 });
      renderSocdList();
      renderGrid();
      updateUI();
      updateSocdHint();
      log(`Added SOCD pair: Button ${idx1+1} ↔ ${idx2+1}`);
    } else if (resp && resp.startsWith('ERROR')) {
      log(`Failed to add SOCD pair: ${resp}`, true);
    } else {
      log('No clear response – refreshing SOCD status', false);
      await fetchSocd();
    }
  } catch (e) {
    log(`Add SOCD error: ${e.message}`, true);
  } finally {
    busy = false;
    updateUI();
  }
}

async function removeSocdPair(index) {
  if (!writer || busy) return;
  busy = true;
  updateUI();
  try {
    await sendCommand(`SOCD REMOVE ${index+1}`);
    await new Promise(r => setTimeout(r, 50));
    const resp = await readUntil(line => line.startsWith('OK') || line.startsWith('ERROR'), 2000);
    if (resp === null) return;
    if (resp && resp.startsWith('OK')) {
      socdPairs.splice(index, 1);
      renderSocdList();
      renderGrid();
      updateUI();
      updateSocdHint();
      log(`Removed SOCD pair ${index+1}`);
    } else if (resp && resp.startsWith('ERROR')) {
      log(`Failed to remove SOCD pair: ${resp}`, true);
    } else {
      log('No clear response – refreshing SOCD status', false);
      await fetchSocd();
    }
  } catch (e) {
    log(`Remove SOCD error: ${e.message}`, true);
  } finally {
    busy = false;
    updateUI();
  }
}

async function clearAllSocd() {
  if (!writer || busy) return;
  busy = true;
  updateUI();
  try {
    await sendCommand('SOCD CLEAR');
    await new Promise(r => setTimeout(r, 50));
    const resp = await readUntil(line => line.startsWith('OK') || line.startsWith('ERROR'), 2000);
    if (resp === null) return;
    if (resp && resp.startsWith('OK')) {
      socdPairs = [];
      renderSocdList();
      renderGrid();
      updateUI();
      updateSocdHint();
      log('Cleared all SOCD pairs');
    } else if (resp && resp.startsWith('ERROR')) {
      log(`Failed to clear SOCD: ${resp}`, true);
    } else {
      log('No clear response – refreshing SOCD status', false);
      await fetchSocd();
    }
  } catch (e) {
    log(`Clear SOCD error: ${e.message}`, true);
  } finally {
    busy = false;
    updateUI();
  }
}

// ---------- Set Press/Release/Mode ----------
async function setPressKey(index, keyName) {
  if (index < 0 || index > 5) return false;
  if (!writer || busy) return false;
  busy = true;
  updateUI();
  try {
    await sendCommand(`SETPRESS ${index+1}:${keyName}`);
    await new Promise(r => setTimeout(r, 50));
    const resp = await readUntil(line => line === 'OK', 1500);
    if (resp === null) return false;
    if (resp === 'OK') {
      pressKeys[index] = keyName;
      updateKeyLabel(index);
      updateDisplays();
      log(`Set press key for Button ${index+1}: "${keyName}"`);
      await new Promise(r => setTimeout(r, 50));
      await fetchSocd();
      renderGrid();
      return true;
    } else {
      log(`Failed to set press key: ${resp}`, true);
      return false;
    }
  } catch (e) {
    log(`Set press error: ${e.message}`, true);
    return false;
  } finally {
    busy = false;
    updateUI();
  }
}

async function setReleaseKey(index, keyName) {
  if (index < 0 || index > 5) return false;
  if (!writer || busy) return false;
  busy = true;
  updateUI();
  try {
    await sendCommand(`SETRELEASE ${index+1}:${keyName}`);
    await new Promise(r => setTimeout(r, 50));
    const resp = await readUntil(line => line === 'OK', 1500);
    if (resp === null) return false;
    if (resp === 'OK') {
      releaseKeys[index] = keyName;
      updateKeyLabel(index);
      updateDisplays();
      log(`Set release key for Button ${index+1}: "${keyName}"`);
      return true;
    } else {
      log(`Failed to set release key: ${resp}`, true);
      return false;
    }
  } catch (e) {
    log(`Set release error: ${e.message}`, true);
    return false;
  } finally {
    busy = false;
    updateUI();
  }
}

async function setMode(index, modeVal) {
  if (index < 0 || index > 5) return false;
  if (!writer || busy) return false;
  if (modeVal === modes[index]) return true;
  
  if (modeVal === 1 || modeVal === 2) {
    removeSocdPairByButton(index);
  }
  
  busy = true;
  updateUI();
  try {
    await sendCommand(`SETMODE ${index+1}:${modeVal}`);
    await new Promise(r => setTimeout(r, 50));
    const resp = await readUntil(line => line === 'OK', 1500);
    if (resp === null) return false;
    if (resp === 'OK') {
      modes[index] = modeVal;
      updateKeyLabel(index);
      updateDisplays();
      log(`Set mode for Button ${index+1} to ${modeVal === 0 ? 'Key' : (modeVal === 1 ? 'Dual' : 'Macro')}`);
      await new Promise(r => setTimeout(r, 50));
      await fetchSocd();
      renderGrid();
      if (modeVal === 2) {
        renderMacroEditor(index);
      }
      return true;
    } else {
      log(`Failed to set mode: ${resp}`, true);
      return false;
    }
  } catch (e) {
    log(`Set mode error: ${e.message}`, true);
    return false;
  } finally {
    busy = false;
    updateUI();
  }
}

// ---------- Refresh ----------
async function refreshAll() {
  if (writer && !busy) {
    await fetchAllData();
    await fetchSocd();
    if (selectedIndex !== null) {
      const mode = modes[selectedIndex] || 0;
      document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
      toggleModeControls(mode);
      updateDisplays();
      if (mode === 2) {
        renderMacroEditor(selectedIndex);
      }
    }
    updateModeSectionState();
  }
}

// ---------- Reset ----------
async function resetToDefaults() {
  if (!writer || busy) return;
  if (!confirm('Reset all keys to defaults (q,w,e,a,s,d) and clear SOCD?')) return;
  busy = true;
  updateUI();
  try {
    await sendCommand('RESET');
    const resp = await readUntil(line => line === 'OK RESET', 2000);
    if (resp === null) return;
    if (resp) {
      log('Reset to defaults');
      busy = false;
      await fetchAllData();
      await fetchSocd();
      if (selectedIndex !== null) {
        const mode = modes[selectedIndex] || 0;
        document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
        toggleModeControls(mode);
        updateDisplays();
        if (mode === 2) {
          renderMacroEditor(selectedIndex);
        }
      }
      updateModeSectionState();
    } else {
      log('Reset timed out', true);
    }
  } catch (e) {
    log(`Reset error: ${e.message}`, true);
  } finally {
    busy = false;
    updateUI();
  }
}

// ---------- Connect / Disconnect ----------
async function connect() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    writer = port.writable.getWriter();
    reader = port.readable.getReader();
    updateUI();
    log('Connected to Arduino');
    await new Promise(r => setTimeout(r, 50));
    await refreshAll();
    selectedIndex = null;
    selectedStepIndex = null;
    renderGrid();
    updateControls();
    updateUI();
    updateModeSectionState();

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
  const oldReader = reader;
  const oldWriter = writer;
  const oldPort = port;
  reader = null;
  writer = null;
  port = null;
  busy = false;
  try {
    if (oldReader) await oldReader.cancel();
    if (oldWriter) await oldWriter.close();
    if (oldPort) await oldPort.close();
  } catch (e) { /* ignore */ }
  pressKeys = [];
  releaseKeys = [];
  modes = [];
  macroData = [];
  selectedIndex = null;
  selectedStepIndex = null;
  socdPairs = [];
  socdPicking = false;
  socdPickBuffer = [];
  renderGrid();
  renderSocdList();
  updateUI();
  updateSocdHint();
  updateModeSectionState();
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
      { label: 'F13', value: 'F13' }, { label: 'F14', value: 'F14' }, { label: 'F15', value: 'F15' },
      { label: 'F16', value: 'F16' }, { label: 'F17', value: 'F17' }, { label: 'F18', value: 'F18' },
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
    log('Please select a button first');
    return;
  }
  if (!writer || busy) {
    log('Not connected or busy');
    return;
  }
  const mode = modes[selectedIndex] || 0;
  if (mode === 0) {
    await setPressKey(selectedIndex, value);
    if (modes[selectedIndex] !== 0) {
      await setMode(selectedIndex, 0);
    }
    document.querySelector('input[name="mode"][value="0"]').checked = true;
    toggleModeControls(0);
  } else if (mode === 1) {
    if (dualTarget === 'press') {
      await setPressKey(selectedIndex, value);
    } else {
      await setReleaseKey(selectedIndex, value);
    }
    updateDisplays();
  } else if (mode === 2) {
    if (selectedStepIndex === null) {
      log('Please select a step first (click on its key display)');
      return;
    }
    const steps = macroData[selectedIndex]?.steps || [];
    if (selectedStepIndex >= steps.length) {
      log('Selected step does not exist', true);
      return;
    }
    const step = steps[selectedStepIndex];
    if (step.action === 'D') {
      log('Delay steps do not use keys – set the delay value instead.', true);
      return;
    }
    step.key = value;
    renderMacroEditor(selectedIndex);
    updateKeyLabel(selectedIndex);
    log(`Assigned "${value}" to step ${selectedStepIndex+1}`);
  }
}

// ---------- Event Handlers ----------
modeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    if (selectedIndex === null) return;
    const mode = parseInt(document.querySelector('input[name="mode"]:checked').value);
    toggleModeControls(mode);
    setMode(selectedIndex, mode);
  });
});

document.querySelectorAll('.dual-slot').forEach(el => {
  el.addEventListener('click', () => {
    if (selectedIndex === null) return;
    if (modes[selectedIndex] !== 1) return;
    const slot = el.dataset.slot;
    if (slot === 'press' || slot === 'release') {
      dualTarget = slot;
      updateDisplays();
      log(`Dual target set to: ${slot}`);
    }
  });
});

copyPressToReleaseBtn.addEventListener('click', async () => {
  if (selectedIndex === null) { log('Select a button first'); return; }
  if (!writer || busy) { log('Not connected or busy'); return; }
  const press = pressKeys[selectedIndex] || '';
  if (!press) { log('No press key to copy'); return; }
  await setReleaseKey(selectedIndex, press);
  if (modes[selectedIndex] !== 1) {
    await setMode(selectedIndex, 1);
    document.querySelector('input[name="mode"][value="1"]').checked = true;
    toggleModeControls(1);
  }
});

applyDualBtn.addEventListener('click', async () => {
  if (selectedIndex === null) { log('Select a button first'); return; }
  if (!writer || busy) { log('Not connected or busy'); return; }
  const press = pressKeys[selectedIndex] || '';
  const release = releaseKeys[selectedIndex] || '';
  if (!press || !release) { log('Both press and release keys are required'); return; }
  if (modes[selectedIndex] !== 1) {
    await setMode(selectedIndex, 1);
  }
  document.querySelector('input[name="mode"][value="1"]').checked = true;
  toggleModeControls(1);
});

addStepBtn.addEventListener('click', addStep);
clearMacroBtn.addEventListener('click', clearMacro);
applyMacroBtn.addEventListener('click', applyMacro);

refreshBtn.addEventListener('click', async () => {
  if (writer && !busy) { await refreshAll(); }
});
resetBtn.addEventListener('click', resetToDefaults);

socdAddBtn.addEventListener('click', toggleSocdPicking);
socdClearBtn.addEventListener('click', async () => {
  if (writer && !busy) {
    if (confirm('Remove all SOCD pairs?')) await clearAllSocd();
  }
});

function toggleSocdPicking() {
  if (!writer || busy) {
    log('Not connected or busy');
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

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);

// ---------- Init ----------
buildKeyboard();
updateUI();
renderSocdList();
updateSocdHint();
updateModeSectionState();
if (!('serial' in navigator)) {
  log('❌ Web Serial API not supported. Use Chrome/Edge.', true);
  connectBtn.disabled = true;
}