// Auto Clicker Meow — Popup Script
// Handles UI interactions, messaging with background, and recording management

document.addEventListener('DOMContentLoaded', async () => {
  // ─── DOM Elements ───
  const btnRecord = document.getElementById('btnRecord');
  const btnStop = document.getElementById('btnStop');
  const btnPause = document.getElementById('btnPause');
  const btnPlay = document.getElementById('btnPlay');
  const statusBadge = document.getElementById('statusBadge');
  const btnTheme = document.getElementById('btnTheme');
  const repeatCountInput = document.getElementById('repeatCount');
  const btnRepeatMinus = document.getElementById('btnRepeatMinus');
  const btnRepeatPlus = document.getElementById('btnRepeatPlus');
  const btnInfinite = document.getElementById('btnInfinite');
  const speedButtons = document.querySelectorAll('.speed-btn');
  const startDelayInput = document.getElementById('startDelay');
  const recordingsList = document.getElementById('recordingsList');
  const recordingCount = document.getElementById('recordingCount');

  // Auto-Click elements
  const btnAutoClick = document.getElementById('btnAutoClick');
  const clickIntervalInput = document.getElementById('clickInterval');
  const clickTypeButtons = document.querySelectorAll('.click-type-btn');

  // Export/Import/Clear
  const btnExport = document.getElementById('btnExport');
  const btnImport = document.getElementById('btnImport');
  const btnClearAll = document.getElementById('btnClearAll');
  const fileImport = document.getElementById('fileImport');

  // Countdown
  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNumber = document.getElementById('countdownNumber');
  const countdownCancel = document.getElementById('countdownCancel');

  // Pause button sub-elements
  const pauseIcon = btnPause.querySelector('.pause-icon');
  const resumeIcon = btnPause.querySelector('.resume-icon');
  const pauseLabel = btnPause.querySelector('.pause-label');

  // Rules modal elements
  const rulesModal = document.getElementById('rulesModal');
  const rulesModalClose = document.getElementById('rulesModalClose');
  const rulesEventsList = document.getElementById('rulesEventsList');
  const btnCancelRules = document.getElementById('btnCancelRules');
  const btnSaveRules = document.getElementById('btnSaveRules');
  let currentEditingRecId = null;
  let currentEditingEvents = [];

  // ─── State ───
  let currentSpeed = 1;
  let isInfinite = false;
  let selectedRecordingId = null;
  let currentClickType = 'click';
  let countdownTimer = null;
  let lastRepeatCount = 1;

  // ─── Initialize ───
  const state = await sendMessage({ action: 'getState' });
  updateUI(state);
  await loadRecordings();

  // ─── Theme Management ───
  const sunIcon = btnTheme.querySelector('.sun-icon');
  const moonIcon = btnTheme.querySelector('.moon-icon');

  // Load saved theme
  const storedTheme = await chrome.storage.local.get('theme');
  const currentTheme = storedTheme.theme || 'dark';
  setTheme(currentTheme);

  btnTheme.addEventListener('click', () => {
    const activeTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    setTheme(activeTheme);
  });

  function setTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      sunIcon.style.display = 'none';
      moonIcon.style.display = 'block';
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      sunIcon.style.display = 'block';
      moonIcon.style.display = 'none';
    }
    chrome.storage.local.set({ theme });
  }

  // ─── Message Helper ───
  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('sendMessage error:', chrome.runtime.lastError.message);
        }
        resolve(response || {});
      });
    });
  }

  // ─── Update UI Based on State ───
  function updateUI(state) {
    if (!state) return;

    const status = state.status || 'idle';

    // Status Badge
    statusBadge.className = 'status-badge';
    const statusText = statusBadge.querySelector('.status-text');

    switch (status) {
      case 'recording':
        statusBadge.classList.add('recording');
        statusText.textContent = 'Recording';
        btnRecord.classList.add('active');
        btnRecord.disabled = true;
        btnStop.disabled = false;
        btnPause.disabled = false;
        setPauseMode(false);
        btnPlay.disabled = true;
        btnAutoClick.disabled = true;
        break;

      case 'recording-paused':
        statusBadge.className = 'status-badge paused';
        statusText.textContent = 'Rec Paused';
        btnRecord.classList.add('active');
        btnRecord.disabled = true;
        btnStop.disabled = false;
        btnPause.disabled = false;
        setPauseMode(true);
        btnPlay.disabled = true;
        btnAutoClick.disabled = true;
        break;

      case 'replaying':
        statusBadge.classList.add('replaying');
        statusText.textContent = 'Replaying';
        btnRecord.classList.remove('active');
        btnRecord.disabled = true;
        btnStop.disabled = false;
        btnPause.disabled = false;
        setPauseMode(false);
        btnPlay.classList.add('active');
        btnPlay.disabled = true;
        btnAutoClick.disabled = true;
        break;

      case 'paused':
        statusBadge.classList.add('paused');
        statusText.textContent = 'Paused';
        btnRecord.classList.remove('active');
        btnRecord.disabled = true;
        btnStop.disabled = false;
        btnPause.disabled = false;
        setPauseMode(true);
        btnPlay.classList.remove('active');
        btnPlay.disabled = true;
        btnAutoClick.disabled = true;
        break;

      case 'autoclicking':
        statusBadge.classList.add('autoclicking');
        statusText.textContent = 'Auto-Click';
        btnRecord.classList.remove('active');
        btnRecord.disabled = true;
        btnStop.disabled = false;
        btnPause.disabled = true;
        btnPlay.disabled = true;
        btnPlay.classList.remove('active');
        btnAutoClick.classList.add('active');
        btnAutoClick.querySelector('span').textContent = 'Stop Auto-Click';
        break;

      default: // idle
        statusText.textContent = 'Idle';
        btnRecord.classList.remove('active');
        btnRecord.disabled = false;
        btnStop.disabled = true;
        btnPause.disabled = true;
        setPauseMode(false);
        btnPlay.classList.remove('active');
        btnPlay.disabled = !selectedRecordingId;
        btnAutoClick.classList.remove('active');
        btnAutoClick.querySelector('span').textContent = 'Start Auto-Click';
        btnAutoClick.disabled = false;
        break;
    }
  }

  function setPauseMode(isResume) {
    if (isResume) {
      btnPause.classList.add('is-resume');
      pauseIcon.style.display = 'none';
      resumeIcon.style.display = '';
      pauseLabel.textContent = 'Resume';
    } else {
      btnPause.classList.remove('is-resume');
      pauseIcon.style.display = '';
      resumeIcon.style.display = 'none';
      pauseLabel.textContent = 'Pause';
    }
  }

  // ─── Record Button ───
  btnRecord.addEventListener('click', async () => {
    const result = await sendMessage({ action: 'startRecording' });
    if (result.success) {
      updateUI({ status: 'recording' });
    }
  });

  // ─── Stop Button ───
  btnStop.addEventListener('click', async () => {
    const currentState = await sendMessage({ action: 'getState' });
    if (currentState.status === 'recording' || currentState.status === 'recording-paused') {
      await sendMessage({ action: 'stopRecording' });
    } else if (currentState.status === 'replaying' || currentState.status === 'paused') {
      await sendMessage({ action: 'stopReplay' });
    } else if (currentState.status === 'autoclicking') {
      await sendMessage({ action: 'stopAutoClick' });
    }
    updateUI({ status: 'idle' });
    // Reload recordings after a short delay
    setTimeout(loadRecordings, 500);
  });

  // ─── Pause/Resume Button ───
  btnPause.addEventListener('click', async () => {
    const currentState = await sendMessage({ action: 'getState' });
    if (currentState.status === 'replaying') {
      await sendMessage({ action: 'pauseReplay' });
      updateUI({ status: 'paused' });
    } else if (currentState.status === 'paused') {
      await sendMessage({ action: 'resumeReplay' });
      updateUI({ status: 'replaying' });
    } else if (currentState.status === 'recording') {
      await sendMessage({ action: 'pauseRecording' });
      updateUI({ status: 'recording-paused' });
    } else if (currentState.status === 'recording-paused') {
      await sendMessage({ action: 'resumeRecording' });
      updateUI({ status: 'recording' });
    }
  });

  // ─── Play Button ───
  btnPlay.addEventListener('click', async () => {
    if (!selectedRecordingId) return;

    const delay = parseInt(startDelayInput.value) || 0;

    if (delay > 0) {
      // Show countdown
      startCountdown(delay, () => {
        executePlayback();
      });
    } else {
      executePlayback();
    }
  });

  async function executePlayback() {
    const config = {
      repeatCount: parseInt(repeatCountInput.value) || 1,
      speed: currentSpeed,
      infinite: isInfinite
    };

    const result = await sendMessage({
      action: 'startReplay',
      recordingId: selectedRecordingId,
      config
    });

    if (result.success) {
      updateUI({ status: 'replaying' });
    }
  }

  // ─── Countdown ───
  function startCountdown(seconds, callback) {
    let remaining = seconds;
    countdownOverlay.classList.add('active');
    countdownNumber.textContent = remaining;

    countdownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        cancelCountdown();
        callback();
      } else {
        countdownNumber.textContent = remaining;
      }
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownOverlay.classList.remove('active');
  }

  countdownCancel.addEventListener('click', () => {
    cancelCountdown();
  });

  // ─── Repeat Count Controls ───
  btnRepeatMinus.addEventListener('click', () => {
    if (isInfinite) {
      isInfinite = false;
      btnInfinite.classList.remove('active');
      repeatCountInput.classList.remove('infinite');
      repeatCountInput.disabled = false;
      const newVal = Math.max(1, lastRepeatCount - 1);
      repeatCountInput.value = newVal;
      lastRepeatCount = newVal;
      return;
    }
    const val = parseInt(repeatCountInput.value) || 1;
    const newVal = Math.max(1, val - 1);
    repeatCountInput.value = newVal;
    lastRepeatCount = newVal;
  });

  btnRepeatPlus.addEventListener('click', () => {
    if (isInfinite) {
      isInfinite = false;
      btnInfinite.classList.remove('active');
      repeatCountInput.classList.remove('infinite');
      repeatCountInput.disabled = false;
      const newVal = Math.min(999, lastRepeatCount + 1);
      repeatCountInput.value = newVal;
      lastRepeatCount = newVal;
      return;
    }
    const val = parseInt(repeatCountInput.value) || 1;
    const newVal = Math.min(999, val + 1);
    repeatCountInput.value = newVal;
    lastRepeatCount = newVal;
  });

  repeatCountInput.addEventListener('change', () => {
    let val = parseInt(repeatCountInput.value);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 999) val = 999;
    repeatCountInput.value = val;
    lastRepeatCount = val;
  });

  btnInfinite.addEventListener('click', () => {
    isInfinite = !isInfinite;
    btnInfinite.classList.toggle('active', isInfinite);
    if (isInfinite) {
      const val = parseInt(repeatCountInput.value);
      if (!isNaN(val) && val >= 1) {
        lastRepeatCount = val;
      }
      repeatCountInput.value = '∞';
      repeatCountInput.classList.add('infinite');
      repeatCountInput.disabled = true;
      btnRepeatMinus.disabled = false;
      btnRepeatPlus.disabled = false;
    } else {
      repeatCountInput.value = lastRepeatCount;
      repeatCountInput.classList.remove('infinite');
      repeatCountInput.disabled = false;
      btnRepeatMinus.disabled = false;
      btnRepeatPlus.disabled = false;
    }
  });

  // ─── Speed Selector ───
  speedButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      speedButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpeed = parseFloat(btn.dataset.speed);
    });
  });

  // ─── Click Type Selector ───
  clickTypeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      clickTypeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentClickType = btn.dataset.type;
    });
  });

  // ─── Auto-Click Button ───
  btnAutoClick.addEventListener('click', async () => {
    const currentState = await sendMessage({ action: 'getState' });

    if (currentState.status === 'autoclicking') {
      await sendMessage({ action: 'stopAutoClick' });
      updateUI({ status: 'idle' });
    } else if (currentState.status === 'idle') {
      const config = {
        interval: parseInt(clickIntervalInput.value) || 1000,
        clickType: currentClickType
      };
      const result = await sendMessage({ action: 'startAutoClick', config });
      if (result.success) {
        updateUI({ status: 'autoclicking' });
      }
    }
  });

  // ─── Export All Recordings ───
  btnExport.addEventListener('click', async () => {
    const result = await sendMessage({ action: 'getRecordings' });
    const recordings = result.recordings || [];
    if (recordings.length === 0) return;

    const data = JSON.stringify(recordings, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autoclicker-recordings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // ─── Import Recordings ───
  btnImport.addEventListener('click', () => {
    fileImport.click();
  });

  fileImport.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const recordings = Array.isArray(data) ? data : [data];

      for (const rec of recordings) {
        // Regenerate ID and timestamp to avoid conflicts
        rec.id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        rec.createdAt = new Date().toISOString();
        if (!rec.events) rec.events = [];
        if (!rec.name) rec.name = 'Imported Recording';
        rec.eventCount = rec.events.length;
        if (!rec.duration && rec.events.length > 0) {
          rec.duration = rec.events[rec.events.length - 1].timestamp || 0;
        }

        await sendMessage({ action: 'importRecording', recording: rec });
        // Small delay between imports to ensure unique IDs
        await new Promise(r => setTimeout(r, 15));
      }

      await loadRecordings();
    } catch (err) {
      console.error('Import failed:', err);
    }

    fileImport.value = '';
  });

  // ─── Custom Confirm Dialog ───
  let confirmCallback = null;

  function showCustomConfirm(title, message, onConfirm) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    confirmCallback = onConfirm;
    document.getElementById('confirmModal').classList.add('active');
  }

  function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
    confirmCallback = null;
  }

  document.getElementById('btnConfirmOk').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirmModal();
  });

  document.getElementById('btnConfirmCancel').addEventListener('click', closeConfirmModal);
  document.getElementById('confirmModalClose').addEventListener('click', closeConfirmModal);

  // ─── Clear All Recordings ───
  btnClearAll.addEventListener('click', async () => {
    const result = await sendMessage({ action: 'getRecordings' });
    const recordings = result.recordings || [];
    if (recordings.length === 0) return;

    showCustomConfirm(
      'Clear All Recordings',
      `Delete all ${recordings.length} recording(s)? This cannot be undone.`,
      async () => {
        await sendMessage({ action: 'clearRecordings' });
        selectedRecordingId = null;
        await loadRecordings();
      }
    );
  });

  // ─── Load Recordings ───
  async function loadRecordings() {
    const result = await sendMessage({ action: 'getRecordings' });
    const recordings = result.recordings || [];

    recordingCount.textContent = recordings.length;

    if (recordings.length === 0) {
      recordingsList.innerHTML = '';
      recordingsList.appendChild(createEmptyState());
      btnPlay.disabled = true;
      selectedRecordingId = null;
      return;
    }

    recordingsList.innerHTML = '';

    // Show in reverse order (newest first)
    [...recordings].reverse().forEach(rec => {
      const card = createRecordingCard(rec);
      recordingsList.appendChild(card);
    });

    // Auto-select first if none selected
    if (!selectedRecordingId || !recordings.find(r => r.id === selectedRecordingId)) {
      selectedRecordingId = recordings[recordings.length - 1].id;
      updateCardSelection();
      btnPlay.disabled = false;
    }
  }

  function createEmptyState() {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,0.1)" stroke-width="2" stroke-dasharray="4 4"/>
        <circle cx="24" cy="24" r="8" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
        <path d="M24 16v16M16 24h16" stroke="rgba(255,255,255,0.1)" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p>No recordings yet</p>
      <span>Click Record to start capturing</span>
    `;
    return div;
  }

  function createRecordingCard(rec) {
    const card = document.createElement('div');
    card.className = 'recording-card';
    card.dataset.id = rec.id;

    if (rec.id === selectedRecordingId) {
      card.classList.add('selected');
    }

    const duration = formatDuration(rec.duration || 0);
    const eventCount = rec.eventCount || 0;
    const date = formatDate(rec.createdAt);

    card.innerHTML = `
      <div class="rec-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="8" cy="8" r="2" fill="currentColor"/>
        </svg>
      </div>
      <div class="rec-info">
        <div class="rec-name" data-id="${rec.id}">${escapeHtml(rec.name)}</div>
        <div class="rec-meta">
          <span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1"/>
              <path d="M5 2.5v3l2 1" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
            </svg>
            ${duration}
          </span>
          <span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 3h6M2 5h6M2 7h4" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
            </svg>
            ${eventCount} events
          </span>
          <span>${date}</span>
        </div>
      </div>
      <div class="rec-actions">
        <button class="rec-action-btn play-rec" data-id="${rec.id}" title="Play">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 1.5L10 6L3 10.5V1.5Z" fill="currentColor"/>
          </svg>
        </button>
        <button class="rec-action-btn duplicate-rec" data-id="${rec.id}" title="Duplicate">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="3.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <path d="M2 9V2.5a.5.5 0 01.5-.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="rec-action-btn edit-rules" data-id="${rec.id}" title="Rules (If/Else)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M4 12l-4-4 4-4M12 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9.5 3l-3 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="rec-action-btn rename-rec" data-id="${rec.id}" title="Rename">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8.5 1.5l2 2-6.5 6.5H2V8L8.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="rec-action-btn delete" data-id="${rec.id}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 3h8M4.5 3V2h3v1M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `;

    // Click to select
    card.addEventListener('click', (e) => {
      if (e.target.closest('.rec-action-btn')) return;
      selectedRecordingId = rec.id;
      updateCardSelection();
      btnPlay.disabled = false;
    });

    // Play button
    card.querySelector('.play-rec').addEventListener('click', async (e) => {
      e.stopPropagation();
      selectedRecordingId = rec.id;
      updateCardSelection();
      btnPlay.click();
    });

    // Duplicate button
    card.querySelector('.duplicate-rec').addEventListener('click', async (e) => {
      e.stopPropagation();
      await sendMessage({ action: 'duplicateRecording', recordingId: rec.id });
      await loadRecordings();
    });

    // Edit Rules button
    card.querySelector('.edit-rules').addEventListener('click', (e) => {
      e.stopPropagation();
      openRulesModal(rec);
    });

    // Rename button
    card.querySelector('.rename-rec').addEventListener('click', (e) => {
      e.stopPropagation();
      startRename(card, rec);
    });

    // Delete button
    card.querySelector('.delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      card.style.transform = 'translateX(100%)';
      card.style.opacity = '0';
      card.style.transition = 'all 0.3s ease';
      setTimeout(async () => {
        await sendMessage({ action: 'deleteRecording', recordingId: rec.id });
        if (selectedRecordingId === rec.id) {
          selectedRecordingId = null;
        }
        await loadRecordings();
      }, 300);
    });

    return card;
  }

  function startRename(card, rec) {
    const nameEl = card.querySelector('.rec-name');
    const currentName = rec.name;

    const input = document.createElement('input');
    input.className = 'rec-name-input';
    input.value = currentName;
    input.maxLength = 50;

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      const newName = input.value.trim() || currentName;
      if (newName !== currentName) {
        await sendMessage({
          action: 'renameRecording',
          recordingId: rec.id,
          newName
        });
      }
      await loadRecordings();
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = currentName;
        input.blur();
      }
    });
  }

  function updateCardSelection() {
    document.querySelectorAll('.recording-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.id === selectedRecordingId);
    });
  }

  function openRulesModal(rec) {
    currentEditingRecId = rec.id;
    currentEditingEvents = JSON.parse(JSON.stringify(rec.events || []));
    
    rulesEventsList.innerHTML = '';
    if (currentEditingEvents.length === 0) {
      rulesEventsList.innerHTML = '<p style="text-align:center;font-size:11px;color:var(--text-muted);">No actions recorded.</p>';
      rulesModal.classList.add('active');
      return;
    }

    currentEditingEvents.forEach((ev, idx) => {
      const row = document.createElement('div');
      row.className = 'rules-event-row';
      
      let eventName = ev.type.toUpperCase();
      if (ev.type === 'click') {
        eventName += ` at (${ev.x}, ${ev.y})`;
      }
      
      const desc = ev.text ? `"${ev.text}"` : (ev.selector || '');
      const condType = ev.conditionType || 'none';
      const condTarget = ev.conditionTarget || '';
      
      row.innerHTML = `
        <div class="rules-event-header">
          <span>ACTION #${idx + 1}: ${eventName}</span>
          <span class="rules-event-desc">${escapeHtml(desc)}</span>
        </div>
        <div class="rules-controls">
          <select class="rules-select" data-idx="${idx}">
            <option value="none" ${condType === 'none' ? 'selected' : ''}>Always Run</option>
            <option value="element_exists" ${condType === 'element_exists' ? 'selected' : ''}>If Element Exists</option>
            <option value="element_not_exists" ${condType === 'element_not_exists' ? 'selected' : ''}>If Element Doesn't Exist</option>
            <option value="text_exists" ${condType === 'text_exists' ? 'selected' : ''}>If Text Present</option>
            <option value="text_not_exists" ${condType === 'text_not_exists' ? 'selected' : ''}>If Text Not Present</option>
          </select>
          <input type="text" class="rules-input ${condType === 'none' ? 'hidden' : ''}" data-idx="${idx}" value="${escapeHtml(condTarget)}" placeholder="Selector or Text...">
        </div>
      `;
      
      const select = row.querySelector('.rules-select');
      const input = row.querySelector('.rules-input');
      
      select.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'none') {
          input.classList.add('hidden');
        } else {
          input.classList.remove('hidden');
        }
        currentEditingEvents[idx].conditionType = val;
      });
      
      input.addEventListener('input', (e) => {
        currentEditingEvents[idx].conditionTarget = e.target.value;
      });
      
      rulesEventsList.appendChild(row);
    });
    
    rulesModal.classList.add('active');
  }

  // Modal setup
  rulesModalClose.addEventListener('click', () => rulesModal.classList.remove('active'));
  btnCancelRules.addEventListener('click', () => rulesModal.classList.remove('active'));
  btnSaveRules.addEventListener('click', async () => {
    if (!currentEditingRecId) return;
    
    const data = await sendMessage({ action: 'getRecordings' });
    const recordings = data.recordings || [];
    const recIdx = recordings.findIndex(r => r.id === currentEditingRecId);
    
    if (recIdx !== -1) {
      recordings[recIdx].events = currentEditingEvents;
      await chrome.storage.local.set({ recordings });
      rulesModal.classList.remove('active');
      await loadRecordings();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    switch (message.action) {
      case 'stateChanged':
        updateUI(message.state);
        if (message.state.status === 'idle') {
          setTimeout(loadRecordings, 300);
        }
        break;
    }
  });

  // ─── Helpers ───
  function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    const date = new Date(isoStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
