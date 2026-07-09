// AutoClicker Pro — Content Script
// Handles event recording, replay (with pause/resume), and auto-click on web pages

(() => {
  // Prevent double injection
  if (window.__autoClickerProInjected) return;
  window.__autoClickerProInjected = true;

  // ─── State ───
  let isRecording = false;
  let isReplaying = false;
  let isPaused = false;
  let recordingId = null;
  let recordedEvents = [];
  let recordingStartTime = 0;
  let replayTimeouts = [];
  let overlay = null;

  // Pause/Resume state
  let pausedReplayData = null; // { recording, config, iteration }
  let replayCompletedCount = 0;

  // Recording Pause/Resume state
  let isRecordingPaused = false;
  let totalPausedDuration = 0;
  let lastPauseTime = 0;

  // Auto-click state
  let isAutoClicking = false;
  let autoClickInterval = null;
  let lastMousePosition = { x: 0, y: 0 };

  // ─── CSS Selector Generator ───
  function getSelector(element) {
    if (!element || element === document || element === document.body) return 'body';

    // Try ID first
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    // Try unique attribute selectors
    const uniqueAttrs = ['data-testid', 'data-id', 'name', 'aria-label'];
    if (element.tagName === 'IMG') {
      uniqueAttrs.push('src', 'alt');
    } else if (element.tagName === 'A') {
      uniqueAttrs.push('href');
    }
    for (const attr of uniqueAttrs) {
      const val = element.getAttribute(attr);
      if (val) {
        const selector = `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
        if (document.querySelectorAll(selector).length === 1) return selector;
      }
    }

    // Build path using nth-child
    const path = [];
    let current = element;
    while (current && current !== document.body && current !== document) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter(c => c.length > 0 && !c.includes(':'));
        if (classes.length > 0) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          child => child.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ') || 'body';
  }

  // ─── Find Element by Selector or Coordinates ───
  function isTextMatch(candText, targetText) {
    if (!candText || !targetText) return false;
    const cleanCand = candText.trim().replace(/\s+/g, ' ').toLowerCase();
    const cleanTarget = targetText.trim().replace(/\s+/g, ' ').toLowerCase();
    if (cleanCand.includes(cleanTarget) || cleanTarget.includes(cleanCand)) return true;

    const targetWords = cleanTarget.split(/[^a-z0-9]/).filter(w => w.length > 2);
    const candWords = cleanCand.split(/[^a-z0-9]/).filter(w => w.length > 2);
    if (targetWords.length > 0 && candWords.length > 0) {
      return candWords.includes(targetWords[0]) || targetWords.includes(candWords[0]);
    }
    return false;
  }

  // ─── Find Element by Selector or Coordinates ───
  function findElement(event) {
    // 1. Try selector first
    if (event.selector && event.selector !== 'body') {
      try {
        const el = document.querySelector(event.selector);
        if (el) {
          // If event.text is saved, verify it matches
          if (event.text) {
            const elText = el.textContent || '';
            if (isTextMatch(elText, event.text)) {
              return el;
            }
          } else {
            // Verify if the element is near coordinates if no text is recorded
            if (event.x === undefined || event.y === undefined) {
              return el;
            }
            const rect = el.getBoundingClientRect();
            const margin = 100;
            if (event.x >= rect.left - margin && event.x <= rect.right + margin &&
                event.y >= rect.top - margin && event.y <= rect.bottom + margin) {
              return el;
            }
          }
        }
      } catch (e) {}
    }

    // 2. Try text search if selector failed or text mismatched
    if (event.text) {
      let tag = 'button, a, [role="button"], input, label, div, span';
      if (event.selector) {
        const parts = event.selector.split(' > ');
        const lastPart = parts[parts.length - 1];
        const tagMatch = lastPart.match(/^[a-z0-9\-]+/i);
        if (tagMatch) {
          tag = tagMatch[0];
        }
      }
      try {
        const candidates = document.querySelectorAll(tag);
        for (const cand of candidates) {
          const candText = cand.textContent || '';
          if (isTextMatch(candText, event.text)) {
            // Verify if it's within a reasonable distance (300px)
            if (event.x !== undefined && event.y !== undefined) {
              const rect = cand.getBoundingClientRect();
              const margin = 300;
              if (event.x >= rect.left - margin && event.x <= rect.right + margin &&
                  event.y >= rect.top - margin && event.y <= rect.bottom + margin) {
                return cand;
              }
            } else {
              return cand;
            }
          }
        }
      } catch (e) {}
    }

    // 3. Fallback: use coordinates
    if (event.x !== undefined && event.y !== undefined) {
      // Temporarily hide overlay if it's visible so it doesn't block elementFromPoint
      const overlayEl = document.getElementById('__autoclicker-overlay');
      let originalDisplay = '';
      if (overlayEl) {
        originalDisplay = overlayEl.style.display;
        overlayEl.style.display = 'none';
      }
      
      const el = document.elementFromPoint(event.x, event.y);
      
      if (overlayEl) {
        overlayEl.style.display = originalDisplay;
      }
      return el || document.body;
    }
    return document.body;
  }

  function getInteractiveTarget(element) {
    if (!element) return null;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(element.tagName) || element.isContentEditable) {
      return element;
    }
    const interactive = element.closest('button, a, [role="button"]');
    return interactive || element;
  }

  // ─── Overlay UI ───
  function createOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = '__autoclicker-overlay';
    overlay.innerHTML = `
      <div class="__ac-status-bar">
        <div class="__ac-dot"></div>
        <span class="__ac-status-text">Ready</span>
        <span class="__ac-event-count">0 events</span>
        <div class="__ac-controls" style="display: none;">
          <button class="__ac-btn __ac-btn-pause" title="Pause Recording">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="__ac-icon-pause"><rect x="2" y="1.5" width="2" height="7" rx="0.5" fill="currentColor"/><rect x="6" y="1.5" width="2" height="7" rx="0.5" fill="currentColor"/></svg>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="__ac-icon-resume" style="display: none;"><path d="M3 2L8 5L3 8V2Z" fill="currentColor"/></svg>
          </button>
          <button class="__ac-btn __ac-btn-stop" title="Stop Recording">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" rx="0.5" fill="currentColor"/></svg>
          </button>
        </div>
      </div>
    `;

    // Add click listeners to overlay buttons
    const btnPause = overlay.querySelector('.__ac-btn-pause');
    const btnStop = overlay.querySelector('.__ac-btn-stop');

    btnPause.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePauseRecording();
    });

    btnStop.addEventListener('click', (e) => {
      e.stopPropagation();
      stopRecording();
    });

    const style = document.createElement('style');
    style.id = '__autoclicker-styles';
    // Remove old style if exists (from re-injection)
    const oldStyle = document.getElementById('__autoclicker-styles');
    if (oldStyle) oldStyle.remove();

    style.textContent = `
      #__autoclicker-overlay {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 2147483647;
        pointer-events: none;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      }
      .__ac-status-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: rgba(15, 15, 35, 0.9);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 50px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
        color: #fff;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.3s ease;
      }
      .__ac-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #6366f1;
        transition: background 0.3s ease;
      }
      .__ac-dot.recording {
        background: #ef4444;
        animation: __ac-pulse 1s infinite;
      }
      .__ac-dot.replaying {
        background: #22c55e;
        animation: __ac-pulse 1.5s infinite;
      }
      .__ac-dot.paused {
        background: #f59e0b;
        animation: none;
      }
      .__ac-dot.autoclicking {
        background: #818cf8;
        animation: __ac-pulse 0.8s infinite;
      }
      .__ac-event-count {
        color: rgba(255, 255, 255, 0.5);
        font-size: 12px;
      }
      .__ac-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: 8px;
        border-left: 1px solid rgba(255, 255, 255, 0.15);
        padding-left: 8px;
        pointer-events: auto;
      }
      .__ac-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.8);
        cursor: pointer;
        transition: all 0.2s ease;
        padding: 0;
      }
      .__ac-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
        border-color: rgba(255, 255, 255, 0.3);
      }
      .__ac-btn-pause:hover {
        border-color: rgba(245, 158, 11, 0.4);
        color: #f59e0b;
        background: rgba(245, 158, 11, 0.1);
      }
      .__ac-btn-stop:hover {
        border-color: rgba(239, 68, 68, 0.4);
        color: #ef4444;
        background: rgba(239, 68, 68, 0.1);
      }
      @keyframes __ac-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.3); }
      }
      .__ac-click-ripple {
        position: fixed;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 2px solid rgba(99, 102, 241, 0.8);
        pointer-events: none;
        z-index: 2147483646;
        animation: __ac-ripple 0.6s ease-out forwards;
      }
      .__ac-click-ripple.replay {
        border-color: rgba(34, 197, 94, 0.8);
      }
      .__ac-click-ripple.autoclick {
        border-color: rgba(129, 140, 248, 0.8);
      }
      @keyframes __ac-ripple {
        0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
      }
    `;

    document.documentElement.appendChild(style);
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function updateOverlay(status, eventCount) {
    if (!overlay) createOverlay();
    const dot = overlay.querySelector('.__ac-dot');
    const text = overlay.querySelector('.__ac-status-text');
    const count = overlay.querySelector('.__ac-event-count');
    const controls = overlay.querySelector('.__ac-controls');

    dot.className = '__ac-dot';
    if (status === 'recording') {
      controls.style.display = 'flex';
      dot.classList.add('recording');
      text.textContent = isRecordingPaused ? '⏸ Paused' : '● Recording';
      text.style.color = isRecordingPaused ? '#f59e0b' : '#ef4444';
    } else if (status === 'replaying') {
      controls.style.display = 'none';
      dot.classList.add('replaying');
      text.textContent = '▶ Replaying';
      text.style.color = '#22c55e';
    } else if (status === 'paused') {
      controls.style.display = 'none';
      dot.classList.add('paused');
      text.textContent = '⏸ Paused';
      text.style.color = '#f59e0b';
    } else if (status === 'autoclicking') {
      controls.style.display = 'none';
      dot.classList.add('autoclicking');
      text.textContent = '🖱 Auto-Clicking';
      text.style.color = '#818cf8';
    } else {
      controls.style.display = 'none';
      text.textContent = 'Ready';
      text.style.color = '#fff';
    }

    if (eventCount !== undefined && eventCount !== null) {
      count.textContent = `${eventCount} event${eventCount !== 1 ? 's' : ''}`;
    }
  }

  function togglePauseRecording() {
    if (!isRecording) return;

    const btnPause = overlay.querySelector('.__ac-btn-pause');
    const iconPause = btnPause.querySelector('.__ac-icon-pause');
    const iconResume = btnPause.querySelector('.__ac-icon-resume');
    const dot = overlay.querySelector('.__ac-dot');
    const text = overlay.querySelector('.__ac-status-text');

    if (isRecordingPaused) {
      // Resume
      isRecordingPaused = false;
      totalPausedDuration += Date.now() - lastPauseTime;
      iconPause.style.display = '';
      iconResume.style.display = 'none';
      btnPause.title = 'Pause Recording';
      
      dot.className = '__ac-dot recording';
      text.textContent = '● Recording';
      text.style.color = '#ef4444';
      
      // Sync state back to background if popup needs updates
      try {
        chrome.runtime.sendMessage({ action: 'recordingStateChanged', isPaused: false });
      } catch (e) {}
    } else {
      // Pause
      isRecordingPaused = true;
      lastPauseTime = Date.now();
      iconPause.style.display = 'none';
      iconResume.style.display = '';
      btnPause.title = 'Resume Recording';

      dot.className = '__ac-dot paused';
      text.textContent = '⏸ Paused';
      text.style.color = '#f59e0b';

      try {
        chrome.runtime.sendMessage({ action: 'recordingStateChanged', isPaused: true });
      } catch (e) {}
    }
  }

  function showClickRipple(x, y, type = 'record') {
    const ripple = document.createElement('div');
    let className = '__ac-click-ripple';
    if (type === 'replay') className += ' replay';
    else if (type === 'autoclick') className += ' autoclick';
    ripple.className = className;
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    document.documentElement.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  function removeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  // ─── Event Recording Handlers ───
  function onMouseEvent(e) {
    if (!isRecording || isRecordingPaused) return;
    // Ignore events on our overlay
    if (e.target.closest && e.target.closest('#__autoclicker-overlay')) return;

    const timestamp = (Date.now() - recordingStartTime) - totalPausedDuration;
    const lastEvent = recordedEvents[recordedEvents.length - 1];
    const delay = lastEvent ? timestamp - lastEvent.timestamp : 0;

    // Extract text content for fuzzy matching
    const interactive = e.target.closest ? e.target.closest('button, a, [role="button"]') : null;
    const rawText = interactive ? interactive.textContent : e.target.textContent;
    const cleanText = rawText ? rawText.trim().replace(/\s+/g, ' ').substring(0, 50) : '';

    const eventData = {
      type: e.type,
      x: e.clientX,
      y: e.clientY,
      pageX: e.pageX,
      pageY: e.pageY,
      button: e.button,
      selector: getSelector(e.target),
      text: cleanText,
      timestamp,
      delay
    };

    recordedEvents.push(eventData);
    updateOverlay('recording', recordedEvents.length);
    showClickRipple(e.clientX, e.clientY, 'record');
  }

  function onKeyboardEvent(e) {
    if (!isRecording || isRecordingPaused) return;
    if (e.target.closest && e.target.closest('#__autoclicker-overlay')) return;

    const timestamp = (Date.now() - recordingStartTime) - totalPausedDuration;
    const lastEvent = recordedEvents[recordedEvents.length - 1];
    const delay = lastEvent ? timestamp - lastEvent.timestamp : 0;

    const eventData = {
      type: e.type,
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      selector: getSelector(e.target),
      timestamp,
      delay
    };

    recordedEvents.push(eventData);
    updateOverlay('recording', recordedEvents.length);
  }

  function onInputEvent(e) {
    if (!isRecording || isRecordingPaused) return;
    if (e.target.closest && e.target.closest('#__autoclicker-overlay')) return;

    const timestamp = (Date.now() - recordingStartTime) - totalPausedDuration;
    const lastEvent = recordedEvents[recordedEvents.length - 1];
    const delay = lastEvent ? timestamp - lastEvent.timestamp : 0;

    const eventData = {
      type: 'input',
      value: e.target.value,
      inputType: e.inputType,
      data: e.data,
      selector: getSelector(e.target),
      timestamp,
      delay
    };

    recordedEvents.push(eventData);
    updateOverlay('recording', recordedEvents.length);
  }

  function onScrollEvent(e) {
    if (!isRecording || isRecordingPaused) return;

    const timestamp = (Date.now() - recordingStartTime) - totalPausedDuration;
    const lastEvent = recordedEvents[recordedEvents.length - 1];

    const target = e.target === document ? document.documentElement : e.target;
    if (!target) return;

    const isWindowScroll = target === document.documentElement || target === document.body;
    const scrollX = isWindowScroll ? window.scrollX : target.scrollLeft;
    const scrollY = isWindowScroll ? window.scrollY : target.scrollTop;
    const selector = isWindowScroll ? 'window' : getSelector(target);

    // Throttle scroll events (max 1 per 100ms for the same selector)
    if (lastEvent && lastEvent.type === 'scroll' && lastEvent.selector === selector && timestamp - lastEvent.timestamp < 100) {
      lastEvent.scrollX = scrollX;
      lastEvent.scrollY = scrollY;
      lastEvent.timestamp = timestamp;
      return;
    }

    const delay = lastEvent ? timestamp - lastEvent.timestamp : 0;

    recordedEvents.push({
      type: 'scroll',
      selector,
      scrollX,
      scrollY,
      timestamp,
      delay
    });

    updateOverlay('recording', recordedEvents.length);
  }

  // ─── Start Recording ───
  function startRecording(id) {
    if (isRecording) return;

    isRecording = true;
    recordingId = id;
    recordedEvents = [];
    recordingStartTime = Date.now();
    isRecordingPaused = false;
    totalPausedDuration = 0;
    lastPauseTime = 0;

    createOverlay();
    updateOverlay('recording', 0);

    document.addEventListener('click', onMouseEvent, true);
    document.addEventListener('dblclick', onMouseEvent, true);
    document.addEventListener('contextmenu', onMouseEvent, true);
    document.addEventListener('keydown', onKeyboardEvent, true);
    document.addEventListener('keyup', onKeyboardEvent, true);
    document.addEventListener('input', onInputEvent, true);
    window.addEventListener('scroll', onScrollEvent, true);
  }

  // ─── Stop Recording ───
  function stopRecording() {
    if (!isRecording) return;

    isRecording = false;

    document.removeEventListener('click', onMouseEvent, true);
    document.removeEventListener('dblclick', onMouseEvent, true);
    document.removeEventListener('contextmenu', onMouseEvent, true);
    document.removeEventListener('keydown', onKeyboardEvent, true);
    document.removeEventListener('keyup', onKeyboardEvent, true);
    document.removeEventListener('input', onInputEvent, true);
    window.removeEventListener('scroll', onScrollEvent, true);

    updateOverlay('idle', recordedEvents.length);

    const recording = {
      id: recordingId,
      events: recordedEvents,
      duration: recordedEvents.length > 0 ? recordedEvents[recordedEvents.length - 1].timestamp : 0,
      eventCount: recordedEvents.length
    };

    // Send recording to background
    chrome.runtime.sendMessage({
      action: 'recordingComplete',
      recording
    });

    setTimeout(removeOverlay, 1500);
  }

  // ─── Replay Engine ───
  function startReplay(recording, config, iteration) {
    if (isReplaying) return;
    if (!recording || !recording.events || recording.events.length === 0) return;

    isReplaying = true;
    isPaused = false;
    replayTimeouts = [];
    replayCompletedCount = 0;

    // Store for pause/resume
    pausedReplayData = { recording, config, iteration };

    createOverlay();
    updateOverlay('replaying', recording.events.length);

    scheduleReplayEvents(recording, config, iteration, 0);
  }

  function evaluateCondition(type, target) {
    if (!type || type === 'none' || !target) return true;
    try {
      const cleanTarget = target.trim();
      switch (type) {
        case 'element_exists':
          return document.querySelector(cleanTarget) !== null;
        case 'element_not_exists':
          return document.querySelector(cleanTarget) === null;
        case 'text_exists':
          return document.body.textContent.toLowerCase().includes(cleanTarget.toLowerCase());
        case 'text_not_exists':
          return !document.body.textContent.toLowerCase().includes(cleanTarget.toLowerCase());
        default:
          return true;
      }
    } catch (e) {
      console.error('Error evaluating replay condition:', e);
      return true;
    }
  }

  function scheduleReplayEvents(recording, config, iteration, startIndex) {
    const speed = config.speed || 1;
    let cumulativeDelay = 0;

    for (let index = startIndex; index < recording.events.length; index++) {
      const event = recording.events[index];
      // First event after resume plays immediately
      const adjustedDelay = (index === startIndex && startIndex > 0) ? 0 : (event.delay / speed);
      cumulativeDelay += adjustedDelay;

      const capturedIndex = index;
      const timeout = setTimeout(() => {
        if (!isReplaying || isPaused) return;

        replayCompletedCount = capturedIndex + 1;

        // Evaluate condition rules
        let shouldExecute = true;
        if (event.conditionType && event.conditionType !== 'none') {
          shouldExecute = evaluateCondition(event.conditionType, event.conditionTarget);
        }

        if (shouldExecute) {
          try {
            replayEvent(event);
          } catch (err) {
            console.error('Error replaying event:', err);
          }
        } else {
          console.log(`Skipped event ${capturedIndex + 1} due to rule constraint: ${event.conditionType} on "${event.conditionTarget}"`);
        }

        // Update overlay with progress
        const progress = capturedIndex + 1;
        const iterInfo = config.infinite ? '∞' : `${iteration + 1}/${config.repeatCount}`;
        const statusText = overlay?.querySelector('.__ac-status-text');
        if (statusText) {
          statusText.textContent = `▶ ${progress}/${recording.events.length} [${iterInfo}]`;
        }

        // Last event in this iteration
        if (capturedIndex === recording.events.length - 1) {
          // Clear timeouts first to prevent race conditions on next iteration
          replayTimeouts = [];
          isReplaying = false;
          pausedReplayData = null;
          replayCompletedCount = 0;

          // Notify background that this iteration is complete
          chrome.runtime.sendMessage({
            action: 'replayComplete',
            recording,
            iteration
          });
        }
      }, cumulativeDelay);

      replayTimeouts.push(timeout);
    }
  }

  function pauseReplay() {
    if (!isReplaying || isPaused) return;
    isPaused = true;
    // Clear all pending timeouts
    replayTimeouts.forEach(t => clearTimeout(t));
    replayTimeouts = [];
    updateOverlay('paused', null);
  }

  function resumeReplay() {
    if (!isPaused || !pausedReplayData) return;
    isPaused = false;
    isReplaying = true;
    const { recording, config, iteration } = pausedReplayData;
    updateOverlay('replaying', recording.events.length);
    scheduleReplayEvents(recording, config, iteration, replayCompletedCount);
  }

  function stopReplay() {
    isReplaying = false;
    isPaused = false;
    replayTimeouts.forEach(t => clearTimeout(t));
    replayTimeouts = [];
    pausedReplayData = null;
    replayCompletedCount = 0;
    updateOverlay('idle', 0);
    setTimeout(removeOverlay, 1000);

    chrome.runtime.sendMessage({ action: 'replayStopped' });
  }

  // ─── Auto-Click Engine ───
  function onMouseMoveTrack(e) {
    lastMousePosition.x = e.clientX;
    lastMousePosition.y = e.clientY;
  }

  function startAutoClick(config) {
    if (isAutoClicking) return;
    isAutoClicking = true;

    document.addEventListener('mousemove', onMouseMoveTrack, true);

    createOverlay();
    updateOverlay('autoclicking', null);

    const interval = config.interval || 1000;
    const clickType = config.clickType || 'click';

    autoClickInterval = setInterval(() => {
      if (!isAutoClicking) return;

      const element = document.elementFromPoint(lastMousePosition.x, lastMousePosition.y);
      if (!element) return;
      // Don't click our own overlay
      if (element.closest && element.closest('#__autoclicker-overlay')) return;

      const coords = { x: lastMousePosition.x, y: lastMousePosition.y };
      const button = clickType === 'contextmenu' ? 2 : 0;

      if (clickType === 'click') {
        simulateClickSequence(element, { ...coords, button });
        if (element.click) element.click();
      } else if (clickType === 'dblclick') {
        simulateDblClickSequence(element, { ...coords, button });
      } else if (clickType === 'contextmenu') {
        simulateContextMenuSequence(element, { ...coords, button });
      }

      showClickRipple(lastMousePosition.x, lastMousePosition.y, 'autoclick');
    }, interval);
  }

  function stopAutoClick() {
    isAutoClicking = false;
    if (autoClickInterval) {
      clearInterval(autoClickInterval);
      autoClickInterval = null;
    }
    document.removeEventListener('mousemove', onMouseMoveTrack, true);
    updateOverlay('idle', 0);
    setTimeout(removeOverlay, 1000);

    chrome.runtime.sendMessage({ action: 'autoClickStopped' });
  }

  // ─── Event Dispatcher ───
  function dispatchMouseEvent(element, type, coords, button = 0) {
    const rect = element.getBoundingClientRect();
    const clientX = coords.x;
    const clientY = coords.y;
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    const pageX = coords.pageX || (clientX + window.scrollX);
    const pageY = coords.pageY || (clientY + window.scrollY);

    const isPointer = type.startsWith('pointer');
    const EventClass = isPointer ? PointerEvent : MouseEvent;
    
    let buttons = 0;
    if (type === 'mousedown' || type === 'pointerdown') {
      buttons = button === 2 ? 2 : 1;
    }

    const eventInit = {
      bubbles: true,
      cancelable: true,
      clientX: clientX,
      clientY: clientY,
      button: button,
      buttons: buttons,
      view: window
    };

    if (isPointer) {
      eventInit.pointerId = 1;
      eventInit.isPrimary = true;
      eventInit.pointerType = 'mouse';
    }

    const ev = new EventClass(type, eventInit);

    // Override coordinates properties for Canvas/WebGL compatibility
    Object.defineProperty(ev, 'offsetX', { get: () => offsetX });
    Object.defineProperty(ev, 'offsetY', { get: () => offsetY });
    Object.defineProperty(ev, 'layerX', { get: () => offsetX });
    Object.defineProperty(ev, 'layerY', { get: () => offsetY });
    Object.defineProperty(ev, 'pageX', { get: () => pageX });
    Object.defineProperty(ev, 'pageY', { get: () => pageY });

    element.dispatchEvent(ev);
  }

  function simulateClickSequence(element, event) {
    const coords = { x: event.x, y: event.y, pageX: event.pageX, pageY: event.pageY };
    const button = event.button || 0;

    dispatchMouseEvent(element, 'pointerdown', coords, button);
    dispatchMouseEvent(element, 'mousedown', coords, button);
    dispatchMouseEvent(element, 'pointerup', coords, button);
    dispatchMouseEvent(element, 'mouseup', coords, button);
    dispatchMouseEvent(element, 'click', coords, button);
  }

  function simulateDblClickSequence(element, event) {
    const coords = { x: event.x, y: event.y, pageX: event.pageX, pageY: event.pageY };
    const button = event.button || 0;

    simulateClickSequence(element, event);
    simulateClickSequence(element, event);
    dispatchMouseEvent(element, 'dblclick', coords, button);
  }

  function simulateContextMenuSequence(element, event) {
    const coords = { x: event.x, y: event.y, pageX: event.pageX, pageY: event.pageY };
    const button = event.button || 0;

    dispatchMouseEvent(element, 'pointerdown', coords, button);
    dispatchMouseEvent(element, 'mousedown', coords, button);
    dispatchMouseEvent(element, 'pointerup', coords, button);
    dispatchMouseEvent(element, 'mouseup', coords, button);
    dispatchMouseEvent(element, 'contextmenu', coords, button);
  }

  // ─── Event Dispatcher ───
  function replayEvent(event) {
    let element = findElement(event);
    if (!element) return;

    element = getInteractiveTarget(element);

    switch (event.type) {
      case 'click': {
        if (element.focus) element.focus();

        simulateClickSequence(element, event);

        if (element.click) {
          element.click();
        }

        showClickRipple(event.x, event.y, 'replay');
        break;
      }

      case 'dblclick': {
        if (element.focus) element.focus();
        
        simulateDblClickSequence(element, event);

        showClickRipple(event.x, event.y, 'replay');
        break;
      }

      case 'contextmenu': {
        if (element.focus) element.focus();
        
        simulateContextMenuSequence(element, event);

        showClickRipple(event.x, event.y, 'replay');
        break;
      }

      case 'keydown':
      case 'keyup': {
        if (element.focus) element.focus();

        const keyEvent = new KeyboardEvent(event.type, {
          bubbles: true,
          cancelable: true,
          key: event.key,
          code: event.code,
          keyCode: event.keyCode,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          view: window
        });
        element.dispatchEvent(keyEvent);

        // Simulate typing for input elements
        if (event.type === 'keydown' && event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
          if (element.isContentEditable) {
            // contentEditable elements don't have .value — use execCommand or textContent
            document.execCommand('insertText', false, event.key);
            element.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (nativeInputValueSetter && nativeInputValueSetter.set) {
              nativeInputValueSetter.set.call(element, (element.value || '') + event.key);
            } else {
              element.value = (element.value || '') + event.key;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        break;
      }

      case 'input': {
        if (element.focus) element.focus();
        if (event.value !== undefined) {
          if (element.isContentEditable) {
            // contentEditable elements don't have .value
            element.textContent = event.value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (nativeInputValueSetter && nativeInputValueSetter.set) {
              nativeInputValueSetter.set.call(element, event.value);
            } else {
              element.value = event.value;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        break;
      }

      case 'scroll': {
        if (!event.selector || event.selector === 'window') {
          window.scrollTo({
            left: event.scrollX,
            top: event.scrollY,
            behavior: 'instant'
          });
        } else {
          try {
            const el = document.querySelector(event.selector);
            if (el) {
              el.scrollLeft = event.scrollX;
              el.scrollTop = event.scrollY;
            }
          } catch (err) {
            console.error('Error replaying element scroll:', err);
          }
        }
        break;
      }
    }
  }

  // ─── Message Listener ───
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'startRecording':
        startRecording(message.recordingId);
        sendResponse({ success: true });
        break;

      case 'stopRecording':
        stopRecording();
        sendResponse({ success: true });
        break;

      case 'pauseRecording':
        if (!isRecordingPaused) togglePauseRecording();
        sendResponse({ success: true });
        break;

      case 'resumeRecording':
        if (isRecordingPaused) togglePauseRecording();
        sendResponse({ success: true });
        break;

      case 'startReplay':
        startReplay(message.recording, message.config, message.iteration);
        sendResponse({ success: true });
        break;

      case 'stopReplay':
        stopReplay();
        sendResponse({ success: true });
        break;

      case 'pauseReplay':
        pauseReplay();
        sendResponse({ success: true });
        break;

      case 'resumeReplay':
        resumeReplay();
        sendResponse({ success: true });
        break;

      case 'startAutoClick':
        startAutoClick(message.config);
        sendResponse({ success: true });
        break;

      case 'stopAutoClick':
        stopAutoClick();
        sendResponse({ success: true });
        break;

      case 'ping':
        sendResponse({ alive: true });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
    return true;
  });
})();
