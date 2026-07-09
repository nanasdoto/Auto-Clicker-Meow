// AutoClicker Pro — Background Service Worker
// Manages state, message routing, storage, and keyboard shortcuts

let state = {
  status: 'idle', // 'idle' | 'recording' | 'replaying' | 'paused' | 'autoclicking'
  activeTabId: null,
  currentRecordingId: null,
  replayConfig: {
    repeatCount: 1,
    speed: 1,
    infinite: false
  },
  replayIteration: 0
};

// ─── State Persistence Helpers ───
async function loadState() {
  const data = await chrome.storage.local.get('activeState');
  if (data.activeState) {
    state = { ...state, ...data.activeState };
  }
}

async function saveState() {
  await chrome.storage.local.set({ activeState: state });
}

// ─── Initialization ───
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('recordings', (data) => {
    if (!data.recordings) {
      chrome.storage.local.set({ recordings: [] });
    }
  });
  chrome.storage.local.set({ activeState: state });
  updateBadge('idle');
});

chrome.runtime.onStartup.addListener(async () => {
  state.status = 'idle';
  state.activeTabId = null;
  state.replayIteration = 0;
  await saveState();
  updateBadge('idle');
});

// ─── Badge Management ───
function updateBadge(status) {
  const config = {
    idle: { text: '', color: '#6366f1' },
    recording: { text: 'REC', color: '#ef4444' },
    replaying: { text: 'PLAY', color: '#22c55e' },
    paused: { text: 'PAUSE', color: '#f59e0b' },
    autoclicking: { text: 'CLICK', color: '#818cf8' },
    'recording-paused': { text: 'REC ⏸', color: '#f59e0b' }
  };
  const { text, color } = config[status] || config.idle;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ─── Keyboard Shortcuts ───
chrome.commands.onCommand.addListener(async (command) => {
  await loadState();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (command === 'toggle-recording') {
    if (state.status === 'idle') {
      startRecording(tab.id);
    } else if (state.status === 'recording') {
      stopRecording(tab.id);
    }
  } else if (command === 'toggle-replay') {
    if (state.status === 'idle') {
      // Replay last recording
      const data = await chrome.storage.local.get('recordings');
      const recordings = data.recordings || [];
      if (recordings.length > 0) {
        const lastRec = recordings[recordings.length - 1];
        startReplay(tab.id, lastRec.id, state.replayConfig);
      }
    } else if (state.status === 'replaying') {
      stopReplay(state.activeTabId);
    } else if (state.status === 'paused') {
      stopReplay(state.activeTabId);
    }
  }
});

// ─── Message Handling ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  loadState().then(() => {
    handleMessage(message, sender).then(sendResponse);
  });
  return true; // async response
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case 'getState':
      return { ...state };

    case 'startRecording': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await startRecording(tab.id);
      }
      return { success: true, status: state.status };
    }

    case 'stopRecording': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const targetTabId = tab ? tab.id : state.activeTabId;
      if (targetTabId) {
        await stopRecording(targetTabId);
      }
      return { success: true, status: state.status };
    }

    case 'startReplay': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await startReplay(tab.id, message.recordingId, message.config);
      }
      return { success: true, status: state.status };
    }

    case 'stopReplay': {
      await stopReplay(state.activeTabId);
      return { success: true, status: state.status };
    }

    case 'pauseReplay': {
      if (state.status === 'replaying' && state.activeTabId) {
        try {
          await chrome.tabs.sendMessage(state.activeTabId, { action: 'pauseReplay' });
          state.status = 'paused';
          updateBadge('paused');
          await saveState();
          notifyPopup();
        } catch (e) {
          console.error('Failed to pause replay:', e);
        }
      }
      return { success: true, status: state.status };
    }

    case 'resumeReplay': {
      if (state.status === 'paused' && state.activeTabId) {
        try {
          await chrome.tabs.sendMessage(state.activeTabId, { action: 'resumeReplay' });
          state.status = 'replaying';
          updateBadge('replaying');
          await saveState();
          notifyPopup();
        } catch (e) {
          console.error('Failed to resume replay:', e);
        }
      }
      return { success: true, status: state.status };
    }

    case 'pauseRecording': {
      if (state.status === 'recording' && state.activeTabId) {
        try {
          await chrome.tabs.sendMessage(state.activeTabId, { action: 'pauseRecording' });
          state.status = 'recording-paused';
          updateBadge('recording-paused');
          await saveState();
          notifyPopup();
        } catch (e) {
          console.error('Failed to pause recording:', e);
        }
      }
      return { success: true, status: state.status };
    }

    case 'resumeRecording': {
      if (state.status === 'recording-paused' && state.activeTabId) {
        try {
          await chrome.tabs.sendMessage(state.activeTabId, { action: 'resumeRecording' });
          state.status = 'recording';
          updateBadge('recording');
          await saveState();
          notifyPopup();
        } catch (e) {
          console.error('Failed to resume recording:', e);
        }
      }
      return { success: true, status: state.status };
    }

    case 'recordingStateChanged': {
      state.status = message.isPaused ? 'recording-paused' : 'recording';
      updateBadge(state.status);
      await saveState();
      notifyPopup();
      return { success: true };
    }

    case 'startAutoClick': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        state.status = 'autoclicking';
        state.activeTabId = tab.id;
        updateBadge('autoclicking');
        await saveState();
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'startAutoClick',
            config: message.config
          });
        } catch (e) {
          // Content script might not be ready, inject it
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          setTimeout(async () => {
            try {
              await chrome.tabs.sendMessage(tab.id, {
                action: 'startAutoClick',
                config: message.config
              });
            } catch (err) {
              console.error('Failed to start auto-click:', err);
              state.status = 'idle';
              updateBadge('idle');
              await saveState();
            }
          }, 200);
        }
        notifyPopup();
      }
      return { success: true, status: state.status };
    }

    case 'stopAutoClick': {
      if (state.activeTabId) {
        try {
          await chrome.tabs.sendMessage(state.activeTabId, { action: 'stopAutoClick' });
        } catch (e) {
          console.error('Failed to stop auto-click:', e);
        }
      }
      state.status = 'idle';
      state.activeTabId = null;
      updateBadge('idle');
      await saveState();
      notifyPopup();
      return { success: true, status: state.status };
    }

    case 'autoClickStopped': {
      state.status = 'idle';
      state.activeTabId = null;
      updateBadge('idle');
      await saveState();
      notifyPopup();
      return { success: true };
    }

    case 'saveRecording': {
      const result = await saveRecording(message.recording);
      return result;
    }

    case 'getRecordings': {
      const data = await chrome.storage.local.get('recordings');
      return { recordings: data.recordings || [] };
    }

    case 'deleteRecording': {
      await deleteRecording(message.recordingId);
      return { success: true };
    }

    case 'renameRecording': {
      await renameRecording(message.recordingId, message.newName);
      return { success: true };
    }

    case 'duplicateRecording': {
      await duplicateRecording(message.recordingId);
      return { success: true };
    }

    case 'clearRecordings': {
      await chrome.storage.local.set({ recordings: [] });
      return { success: true };
    }

    case 'importRecording': {
      const result = await saveRecording(message.recording);
      return result;
    }

    case 'recordingComplete': {
      // Content script finished collecting events
      const recording = message.recording;
      if (recording && recording.events && recording.events.length > 0) {
        await saveRecording(recording);
      }
      state.status = 'idle';
      state.activeTabId = null;
      state.currentRecordingId = null;
      updateBadge('idle');
      await saveState();
      notifyPopup();
      return { success: true };
    }

    case 'replayComplete': {
      // One iteration of replay complete
      state.replayIteration++;
      const maxRepeats = state.replayConfig.infinite ? Infinity : state.replayConfig.repeatCount;
      const tabId = (sender && sender.tab) ? sender.tab.id : state.activeTabId;
      if (tabId) {
        state.activeTabId = tabId;
      }

      if (state.replayIteration < maxRepeats && state.status === 'replaying') {
        // Start next iteration
        try {
          chrome.tabs.sendMessage(tabId, {
            action: 'startReplay',
            recording: message.recording,
            config: state.replayConfig,
            iteration: state.replayIteration
          });
          // Notify popup of progress
          try {
            chrome.runtime.sendMessage({
              action: 'replayProgress',
              iteration: state.replayIteration,
              total: state.replayConfig.infinite ? '∞' : state.replayConfig.repeatCount
            });
          } catch (e) {}
        } catch (e) {
          state.status = 'idle';
          updateBadge('idle');
        }
      } else {
        // All iterations done
        state.status = 'idle';
        state.activeTabId = null;
        state.replayIteration = 0;
        updateBadge('idle');
        notifyPopup();
      }
      await saveState();
      return { success: true };
    }

    case 'replayStopped': {
      state.status = 'idle';
      state.activeTabId = null;
      state.replayIteration = 0;
      updateBadge('idle');
      await saveState();
      notifyPopup();
      return { success: true };
    }

    default:
      return { error: 'Unknown action' };
  }
}

// ─── Helper: Notify popup of state change ───
function notifyPopup() {
  try { chrome.runtime.sendMessage({ action: 'stateChanged', state: { ...state } }); } catch (e) {}
}

// ─── Recording Control ───
async function startRecording(tabId) {
  state.status = 'recording';
  state.activeTabId = tabId;
  state.currentRecordingId = `rec_${Date.now()}`;
  updateBadge('recording');
  await saveState();

  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'startRecording',
      recordingId: state.currentRecordingId
    });
  } catch (e) {
    // Content script might not be ready, inject it
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    // Retry
    setTimeout(async () => {
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'startRecording',
          recordingId: state.currentRecordingId
        });
      } catch (err) {
        console.error('Failed to start recording:', err);
        state.status = 'idle';
        updateBadge('idle');
        await saveState();
      }
    }, 200);
  }

  notifyPopup();
}

async function stopRecording(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'stopRecording' });
  } catch (e) {
    console.error('Failed to stop recording:', e);
    // Content script unreachable — reset state so the extension doesn't get stuck
    state.status = 'idle';
    state.activeTabId = null;
    state.currentRecordingId = null;
    updateBadge('idle');
    await saveState();
    notifyPopup();
  }
  // State will be updated when content script sends recordingComplete
}

// ─── Replay Control ───
async function startReplay(tabId, recordingId, config) {
  const data = await chrome.storage.local.get('recordings');
  const recordings = data.recordings || [];
  const recording = recordings.find(r => r.id === recordingId);

  if (!recording) return;

  state.status = 'replaying';
  state.activeTabId = tabId;
  state.currentRecordingId = recordingId;
  state.replayConfig = config || { repeatCount: 1, speed: 1, infinite: false };
  state.replayIteration = 0;
  updateBadge('replaying');
  await saveState();

  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'startReplay',
      recording,
      config: state.replayConfig,
      iteration: 0
    });
  } catch (e) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    setTimeout(async () => {
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'startReplay',
          recording,
          config: state.replayConfig,
          iteration: 0
        });
      } catch (err) {
        console.error('Failed to start replay:', err);
        state.status = 'idle';
        updateBadge('idle');
        await saveState();
      }
    }, 200);
  }

  notifyPopup();
}

async function stopReplay(tabId) {
  const targetTabId = tabId || state.activeTabId;
  if (targetTabId) {
    try {
      await chrome.tabs.sendMessage(targetTabId, { action: 'stopReplay' });
    } catch (e) {
      console.error('Failed to stop replay:', e);
    }
  }
  state.status = 'idle';
  state.activeTabId = null;
  state.replayIteration = 0;
  updateBadge('idle');
  await saveState();
  notifyPopup();
}

// ─── Storage Operations ───
async function saveRecording(recording) {
  const data = await chrome.storage.local.get('recordings');
  const recordings = data.recordings || [];

  // Prevent saving duplicate recording IDs
  if (recording.id && recordings.some(r => r.id === recording.id)) {
    return { success: true, recording: recordings.find(r => r.id === recording.id) };
  }

  // Ensure recording has required fields
  if (!recording.id) recording.id = `rec_${Date.now()}`;
  if (!recording.name) recording.name = `Recording ${recordings.length + 1}`;
  if (!recording.createdAt) recording.createdAt = new Date().toISOString();
  if (!recording.duration) {
    const events = recording.events || [];
    recording.duration = events.length > 0 ? events[events.length - 1].timestamp : 0;
  }
  recording.eventCount = (recording.events || []).length;

  recordings.push(recording);
  await chrome.storage.local.set({ recordings });
  return { success: true, recording };
}

async function deleteRecording(recordingId) {
  const data = await chrome.storage.local.get('recordings');
  let recordings = data.recordings || [];
  recordings = recordings.filter(r => r.id !== recordingId);
  await chrome.storage.local.set({ recordings });
}

async function renameRecording(recordingId, newName) {
  const data = await chrome.storage.local.get('recordings');
  const recordings = data.recordings || [];
  const rec = recordings.find(r => r.id === recordingId);
  if (rec) {
    rec.name = newName;
    await chrome.storage.local.set({ recordings });
  }
}

async function duplicateRecording(recordingId) {
  const data = await chrome.storage.local.get('recordings');
  const recordings = data.recordings || [];
  const original = recordings.find(r => r.id === recordingId);
  if (!original) return;

  const duplicate = JSON.parse(JSON.stringify(original));
  duplicate.id = `rec_${Date.now()}`;
  duplicate.name = `${original.name} (copy)`;
  duplicate.createdAt = new Date().toISOString();

  recordings.push(duplicate);
  await chrome.storage.local.set({ recordings });
}
