(() => {
const createOverlayManagerFallback = ({
  classes,
  dom,
  feedback,
  notifyExtension,
  processedSignatures,
  setScanState,
  flags,
  defaultStyle
}) => {
  const overlayRegistry = new Map();
  let overlayListenersActive = false;
  let overlayUpdateQueued = false;
  const dismissedFlag = flags?.dismissed ?? 'dismissed';

  const textSnippet = (text) => {
    if (!text) {
      return '';
    }
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  };

  const formatScore = (score) => (typeof score === 'number' ? score.toFixed(2) : 'n/a');

  const ensureStyles = () => {
    if (document.getElementById(classes.styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = classes.styleId;
    style.textContent = `
      .${classes.highlightClass} {
        position: relative;
      }
      .${classes.inlineHighlightClass} {
        position: relative;
        display: inline-block;
        padding: 0 2px;
        border-radius: 6px;
        transition: background 0.2s ease, filter 0.2s ease, color 0.2s ease, text-shadow 0.2s ease;
      }
      .${classes.inlineHighlightClass}--highlight {
        background: linear-gradient(120deg, rgba(223, 41, 53, 0.18), rgba(223, 41, 53, 0.08));
        color: inherit;
        box-shadow: 0 2px 10px rgba(223, 41, 53, 0.25);
      }
      .${classes.inlineHighlightClass}--highlight:hover {
        box-shadow: 0 3px 14px rgba(223, 41, 53, 0.35);
        background: linear-gradient(120deg, rgba(223, 41, 53, 0.28), rgba(223, 41, 53, 0.12));
      }
      .${classes.inlineHighlightClass}--blur {
        filter: blur(6px);
        cursor: pointer;
      }
      .${classes.inlineHighlightClass}--blur[data-revealed="true"] {
        filter: none;
      }
      .${classes.inlineHighlightClass}--redact {
        color: transparent;
        background: rgba(17, 24, 39, 0.92);
        cursor: pointer;
      }
      .${classes.inlineHighlightClass}--redact::after {
        content: attr(data-redact);
        color: #f9fafb;
        letter-spacing: 0.12em;
        font-size: 0.75em;
        opacity: 0.85;
        display: inline-block;
        vertical-align: middle;
      }
      .${classes.inlineHighlightClass}--redact[data-revealed="true"] {
        color: inherit;
        background: rgba(223, 41, 53, 0.12);
      }
      .${classes.inlineHighlightClass}--redact[data-revealed="true"]::after {
        content: '';
      }
      .deb-hate-inline-controls {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
        font-size: 0.75em;
      }
      .deb-hate-inline-controls button {
        border: none;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: inherit;
      }
      .deb-hate-control {
        background: rgba(223, 41, 53, 0.95);
        color: #fff;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .deb-hate-control:hover,
      .deb-hate-control:focus {
        background: rgba(223, 41, 53, 1);
        outline: none;
      }
      .deb-hate-control-action {
        background: rgba(75, 85, 99, 0.9);
        color: #f9fafb;
        margin-left: 6px;
      }
      .deb-hate-control-action:hover,
      .deb-hate-control-action:focus {
        background: rgba(55, 65, 81, 0.95);
        outline: none;
      }
      .${classes.tooltipClass} {
        position: absolute;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 12px;
        background: rgba(17, 24, 39, 0.92);
        color: #ffffff;
        border-radius: 10px;
        box-shadow: 0 14px 30px rgba(17, 24, 39, 0.35);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        line-height: 1.4;
        pointer-events: auto;
        max-width: min(320px, 80vw);
        border: 1px solid rgba(223, 41, 53, 0.4);
        padding-right: 12px;
      }
      .${classes.tooltipClass}::after {
        content: '';
        position: absolute;
        bottom: -8px;
        right: 18px;
        border-width: 8px 8px 0 8px;
        border-style: solid;
        border-color: rgba(17, 24, 39, 0.92) transparent transparent transparent;
        filter: drop-shadow(0 2px 4px rgba(17, 24, 39, 0.25));
      }
      .${classes.tooltipClass} * {
        box-sizing: border-box;
      }
      .${classes.tooltipMetaClass} {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .${classes.tooltipBadgeClass} {
        background: #df2935;
        color: #ffffff;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-weight: 600;
      }
      .${classes.tooltipScoreClass} {
        opacity: 0.7;
        font-size: 11px;
      }
      .${classes.tooltipActionsClass} {
        display: grid;
        grid-auto-flow: column;
        gap: 6px;
      }
      .${classes.tooltipButtonClass} {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.4);
        border-radius: 6px;
        color: #ffffff;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 11px;
        transition: background 0.18s ease, border-color 0.18s ease;
      }
      .${classes.tooltipButtonClass}:hover {
        background: rgba(223, 41, 53, 0.2);
        border-color: rgba(223, 41, 53, 0.8);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const updateTooltipPosition = (host, container) => {
    if (!document.body.contains(host)) {
      container.remove();
      overlayRegistry.delete(host);
      return;
    }

    const rect = host.getBoundingClientRect();
    if ((rect.width === 0 && rect.height === 0) || !container.offsetParent) {
      container.style.visibility = 'hidden';
      return;
    }

    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
    const preferredTop = scrollY + rect.top - container.offsetHeight - 8;
    const fallbackTop = scrollY + rect.bottom + 8;
    const viewportTop = scrollY + 8;
    const top = preferredTop < viewportTop ? fallbackTop : preferredTop;

    const viewportLeft = scrollX + 12;
    const viewportRight = scrollX + document.documentElement.clientWidth - container.offsetWidth - 12;
    let left = scrollX + rect.left + rect.width - container.offsetWidth;
    if (left < viewportLeft) {
      left = viewportLeft;
    }
    if (left > viewportRight) {
      left = viewportRight;
    }

    container.style.visibility = 'visible';
    container.style.position = 'absolute';
    container.style.top = `${top}px`;
    container.style.left = `${left}px`;
  };

  const scheduleOverlayUpdate = () => {
    if (overlayRegistry.size === 0) {
      if (overlayListenersActive) {
        window.removeEventListener('scroll', scheduleOverlayUpdate);
        window.removeEventListener('resize', scheduleOverlayUpdate);
        overlayListenersActive = false;
      }
      return;
    }

    if (!overlayListenersActive) {
      window.addEventListener('scroll', scheduleOverlayUpdate, { passive: true });
      window.addEventListener('resize', scheduleOverlayUpdate);
      overlayListenersActive = true;
    }

    if (overlayUpdateQueued) {
      return;
    }

    overlayUpdateQueued = true;
    requestAnimationFrame(() => {
      overlayUpdateQueued = false;
      overlayRegistry.forEach(({ container, host }) => updateTooltipPosition(host, container));
      if (overlayRegistry.size === 0 && overlayListenersActive) {
        window.removeEventListener('scroll', scheduleOverlayUpdate);
        window.removeEventListener('resize', scheduleOverlayUpdate);
        overlayListenersActive = false;
      }
    });
  };

  const removeHighlight = (el) => {
    if (!el) {
      return;
    }
    el.classList.remove(classes.highlightClass);
    const entry = overlayRegistry.get(el);
    if (entry) {
      dom.unwrapWrappers(entry.wrappers ?? []);
      entry.container?.remove?.();
      entry.control?.remove?.();
      overlayRegistry.delete(el);
      scheduleOverlayUpdate();
    } else {
      dom.unwrapWrappers(Array.from(el.querySelectorAll(`.${classes.inlineHighlightClass}`)));
    }
  };

  const attachFeedback = (el, result = {}, wrappers = [], snippets = [], style = defaultStyle, signature) => {
    const existing = overlayRegistry.get(el);
    if (existing) {
      dom.unwrapWrappers(existing.wrappers ?? []);
      existing.container?.remove?.();
      existing.control?.remove?.();
      overlayRegistry.delete(el);
    }

    const rawScore = typeof result?.score === 'number' ? Number(result.score) : null;
    const scoreText = formatScore(rawScore ?? 0);
    const feedbackText = (snippets.length ? snippets.join(' ') : dom.sanitizeText(el.innerText)).slice(0, 4000);

    const logFeedback = async (action, button) => {
      const reportType = action === 'dismiss' ? 'not_hate' : 'flag';
      const originalLabel = button.textContent;
      const payload = {
        text: feedbackText,
        report_type: reportType
      };
      const historyId = `${signature ?? `anon-${Math.random().toString(16).slice(2)}`}:${reportType}:${Date.now()}`;
      const baseHistory = {
        id: historyId,
        action,
        reportType,
        snippet: textSnippet(feedbackText),
        score: rawScore,
        createdAt: Date.now(),
        status: 'pending'
      };
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

      button.disabled = true;
      button.textContent = action === 'dismiss' ? 'Removing…' : 'Sending…';

      const queueReport = async (message) => {
        const queued = await feedback.queueReport?.({
          id: historyId,
          payload,
          history: baseHistory,
          retries: 0,
          lastError: message
        });
        if (queued) {
          await feedback.addHistoryEntry?.({
            ...baseHistory,
            status: 'queued',
            queuedAt: Date.now(),
            lastError: message
          });
          if (typeof notifyExtension === 'function') {
            notifyExtension('feedback-queued', { entryId: historyId });
          }
          button.textContent = 'Queued';
          return false;
        }

        console.error('Failed to queue feedback:', message);
        button.disabled = false;
        button.textContent = originalLabel || 'Retry';
        if (typeof notifyExtension === 'function') {
          notifyExtension('feedback-error', { entryId: historyId, message });
        }
        return false;
      };

      if (offline) {
        return queueReport('Offline');
      }

      try {
        await feedback.sendPayload?.(payload);

        await feedback.addHistoryEntry?.({
          ...baseHistory,
          status: 'sent',
          sentAt: Date.now()
        });

        if (typeof notifyExtension === 'function') {
          notifyExtension('feedback-sent', { entryId: historyId });
        }

        if (action === 'dismiss') {
          if (signature) {
            processedSignatures.delete(signature);
          }
          setScanState(el, dismissedFlag);
          removeHighlight(el);
          button.textContent = 'Removed';
          return true;
        }

        button.textContent = 'Sent';
        return false;
      } catch (error) {
        console.error('Failed to send feedback:', error);
        return queueReport(error?.message ?? 'Request failed.');
      }
    };

    if (style !== 'highlight') {
      if (!wrappers.length) {
        return;
      }

      const normalizedSnippets = snippets.length ? snippets : [dom.sanitizeText(el.innerText)];

      wrappers.forEach((wrapper, index) => {
        const snippet = normalizedSnippets[index] ?? normalizedSnippets[normalizedSnippets.length - 1] ?? '';
        wrapper.dataset.revealed = wrapper.dataset.revealed ?? 'false';
        if (style === 'redact') {
          wrapper.dataset.redact = dom.makeRedactLabel(snippet);
        }
      });

      const controls = document.createElement('div');
      controls.className = 'deb-hate-inline-controls';
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', 'Hate speech controls');

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'deb-hate-control';
      const isRevealed = wrappers.every((wrapper) => wrapper.dataset.revealed === 'true');
      toggleBtn.textContent = isRevealed ? `Hide • ${scoreText}` : `Show • ${scoreText}`;
      toggleBtn.setAttribute('aria-pressed', String(isRevealed));
      toggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const reveal = wrappers.some((wrapper) => wrapper.dataset.revealed !== 'true');
        wrappers.forEach((wrapper) => {
          wrapper.dataset.revealed = reveal ? 'true' : 'false';
        });
        toggleBtn.setAttribute('aria-pressed', reveal.toString());
        toggleBtn.textContent = reveal ? `Hide • ${scoreText}` : `Show • ${scoreText}`;
      });

      const makeActionButton = (label, action) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'deb-hate-control-action';
        btn.textContent = label;
        btn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const dismissed = await logFeedback(action, btn);
          if (dismissed) {
            controls.remove();
          }
        });
        return btn;
      };

      controls.append(toggleBtn, makeActionButton('Not hate?', 'dismiss'), makeActionButton('Flag', 'flag'));
      const anchor = wrappers[wrappers.length - 1];
      if (anchor?.parentNode) {
        anchor.after(controls);
      } else {
        el.appendChild(controls);
      }
      overlayRegistry.set(el, { type: 'block', host: el, wrappers, control: controls, style });
      el.classList.add(classes.highlightClass);
      return;
    }

    const container = document.createElement('div');
    container.className = classes.tooltipClass;
    container.style.visibility = 'hidden';
    const countLabel = result?.count && result.count > 1 ? `${result.label ?? 'HATE'} • ${result.count}` : result?.label ?? 'HATE';
    container.innerHTML = `
      <div class="${classes.tooltipMetaClass}">
        <span class="${classes.tooltipBadgeClass}">${countLabel}</span>
        <span class="${classes.tooltipScoreClass}">Score: ${scoreText}</span>
      </div>
      <div class="${classes.tooltipActionsClass}">
        <button type="button" class="${classes.tooltipButtonClass}" data-action="dismiss">Not hate?</button>
        <button type="button" class="${classes.tooltipButtonClass}" data-action="flag">Flag</button>
      </div>
    `;

    container.querySelectorAll(`.${classes.tooltipButtonClass}`).forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;
        const dismissed = await logFeedback(action, button);
        if (dismissed) {
          container.remove();
          overlayRegistry.delete(el);
        }
      });
    });

    document.body.appendChild(container);
    overlayRegistry.set(el, { type: 'inline', container, host: el, wrappers });
    el.classList.add(classes.highlightClass);
    el.dataset.debFeedbackAttached = 'true';
    scheduleOverlayUpdate();
    requestAnimationFrame(scheduleOverlayUpdate);
  };

  const clearAll = () => {
    const entries = Array.from(overlayRegistry.keys());
    entries.forEach((element) => removeHighlight(element));
    overlayRegistry.clear();
  };

  return {
    ensureStyles,
    scheduleOverlayUpdate,
    removeHighlight,
    attachFeedback,
    clearAll
  };
};

if (window.__sentinelScannerActive) {
  console.info('[Sentinel] scanner already running on this page.');
} else {
  window.__sentinelScannerActive = true;
  (async () => {
    try {
      const { CONFIG } = await import(chrome.runtime.getURL('extension/config.js'));
      const { createFeedbackManager } = await import(chrome.runtime.getURL('extension/content/feedback.js'));
      const { createDomHelpers } = await import(chrome.runtime.getURL('extension/content/dom.js'));

      const overlayModuleUrl = chrome.runtime.getURL('extension/content/overlay.js');
      let createOverlayManager;
      try {
        const overlayModule = await import(/* @vite-ignore */ overlayModuleUrl);
        createOverlayManager = overlayModule?.createOverlayManager;
      } catch (error) {
        console.error('[Sentinel] Overlay module failed to load:', error);
      }
      if (typeof createOverlayManager !== 'function') {
        console.warn('[Sentinel] Falling back to inline overlay implementation.');
        createOverlayManager = createOverlayManagerFallback;
      }

      const {
        DEFAULT_THRESHOLD,
        TEXT_SELECTORS,
        PRIMARY_TEXT_SELECTOR,
        TARGET_SELECTORS,
        SOCIAL_BLOCK_SELECTORS,
        BASE_SCAN_SELECTOR,
        MIN_TEXT_LENGTH,
        PROCESSED_FLAG,
        DISMISSED_FLAG,
        STYLE_ID,
        HIGHLIGHT_CLASS,
        TOOLTIP_CLASS,
        TOOLTIP_META_CLASS,
        TOOLTIP_BADGE_CLASS,
        TOOLTIP_SCORE_CLASS,
        TOOLTIP_ACTIONS_CLASS,
        TOOLTIP_BUTTON_CLASS,
        INLINE_HIGHLIGHT_CLASS,
        HIGHLIGHT_STYLE_OPTIONS,
        DEFAULT_STYLE,
        STORAGE_KEYS,
        MAX_FEEDBACK_HISTORY,
        FEEDBACK_RETRY_ATTEMPTS,
        FEEDBACK_RETRY_DELAYS
      } = CONFIG;

  const storageLocal = chrome?.storage?.local ?? null;
  const processedSignatures = new Set();
  let activeBatchCount = 0;
  let abortScanning = false;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const sendBackgroundRequest = (payload) =>
    new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            source: 'deb-scanner',
            ...payload
          },
          (response) => {
            if (chrome.runtime?.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response || response.ok !== true) {
              reject(new Error(response?.error || 'Background request failed.'));
              return;
            }
            resolve(response.data ?? null);
          }
        );
      } catch (error) {
        reject(error);
      }
    });

  const fetchWithFallback = async (path, payload) => sendBackgroundRequest({ type: 'proxy-fetch', path, payload });

      const notifyExtension = (type, detail = {}) => {
        try {
          if (typeof chrome?.runtime?.sendMessage === 'function') {
            chrome.runtime.sendMessage({ source: 'deb-scanner', type, detail });
          }
        } catch (error) {
          console.warn('[Sentinel] Failed to notify extension.', error);
        }
      };

      const emitEvent = (name, detail = {}) => {
        document.dispatchEvent(new CustomEvent(name, { detail }));
      };

      const setScanState = (element, state) => {
        if (!element) {
          return;
        }
        if (state) {
          element.dataset.debScanState = state;
          element.dataset.scanned = 'true';
        } else {
          delete element.dataset.debScanState;
        }
      };

      const loadSettings = async () => {
        if (!chrome?.storage?.sync) {
          return { threshold: DEFAULT_THRESHOLD, highlightStyle: DEFAULT_STYLE };
        }
        try {
          const { sensitivity = DEFAULT_THRESHOLD, highlightStyle = DEFAULT_STYLE } = await chrome.storage.sync.get([
            'sensitivity',
            'highlightStyle'
          ]);

          const threshold =
            typeof sensitivity === 'number' && Number.isFinite(sensitivity) ? sensitivity : DEFAULT_THRESHOLD;
          const style = HIGHLIGHT_STYLE_OPTIONS.includes(highlightStyle) ? highlightStyle : DEFAULT_STYLE;
          return { threshold, highlightStyle: style };
        } catch (error) {
          console.warn('[Sentinel] Failed to load settings.', error);
          return { threshold: DEFAULT_THRESHOLD, highlightStyle: DEFAULT_STYLE };
        }
      };

      const {
        sanitizeText,
        findHighlightTarget,
        splitIntoSentences,
        makeRedactLabel,
        highlightRange,
        unwrapWrappers,
        buildSignature
      } = createDomHelpers({
        textSelectors: TEXT_SELECTORS,
        primaryTextSelector: PRIMARY_TEXT_SELECTOR,
        targetSelectors: TARGET_SELECTORS,
        socialBlockSelectors: SOCIAL_BLOCK_SELECTORS,
        minTextLength: MIN_TEXT_LENGTH,
        defaultStyle: DEFAULT_STYLE,
        highlightStyleOptions: HIGHLIGHT_STYLE_OPTIONS,
        inlineHighlightClass: INLINE_HIGHLIGHT_CLASS
      });

      const {
        addFeedbackHistoryEntry,
        queueFeedbackReport,
        schedulePendingFlush,
        initializePendingFeedback,
        sendFeedbackPayload
      } = createFeedbackManager({
        storage: storageLocal,
        notifyExtension,
        storageKeys: STORAGE_KEYS,
        maxHistory: MAX_FEEDBACK_HISTORY,
        retryAttempts: FEEDBACK_RETRY_ATTEMPTS,
        retryDelays: FEEDBACK_RETRY_DELAYS,
        delay,
        fetchWithFallback
      });

      window.addEventListener('online', () => schedulePendingFlush(0));

      const { ensureStyles, scheduleOverlayUpdate, removeHighlight, attachFeedback, clearAll } = createOverlayManager({
        classes: {
          styleId: STYLE_ID,
          highlightClass: HIGHLIGHT_CLASS,
          inlineHighlightClass: INLINE_HIGHLIGHT_CLASS,
          tooltipClass: TOOLTIP_CLASS,
          tooltipMetaClass: TOOLTIP_META_CLASS,
          tooltipBadgeClass: TOOLTIP_BADGE_CLASS,
          tooltipScoreClass: TOOLTIP_SCORE_CLASS,
          tooltipActionsClass: TOOLTIP_ACTIONS_CLASS,
          tooltipButtonClass: TOOLTIP_BUTTON_CLASS
        },
        dom: {
          sanitizeText,
          makeRedactLabel,
          unwrapWrappers
        },
        feedback: {
          addHistoryEntry: addFeedbackHistoryEntry,
          queueReport: queueFeedbackReport,
          sendPayload: sendFeedbackPayload
        },
        notifyExtension,
        processedSignatures,
        setScanState,
        flags: {
          dismissed: DISMISSED_FLAG
        },
        defaultStyle: DEFAULT_STYLE
      });

      const fetchPredictionSingle = async (text) => fetchWithFallback('/predict', { text });

      const fetchPredictionBatch = async (texts) => {
        if (!Array.isArray(texts) || texts.length === 0) {
          return [];
        }

        try {
          const response = await fetchWithFallback('/predict/batch', { texts });
          if (!Array.isArray(response?.results) || response.results.length !== texts.length) {
            throw new Error('Unexpected batch response shape.');
          }
          return response.results;
        } catch (error) {
          console.warn('[Sentinel] Batch endpoint failed; retrying as singles.', error);
          const singles = [];
          for (const text of texts) {
            singles.push(await fetchPredictionSingle(text));
          }
          return singles;
        }
      };

      const shouldSkip = (element, text, signature) => {
        const legacyFlag = element.dataset.scanned === 'true';
        const state = element.dataset.debScanState;
        return (
          text.length < MIN_TEXT_LENGTH ||
          state === PROCESSED_FLAG ||
          state === DISMISSED_FLAG ||
          processedSignatures.has(signature) ||
          (legacyFlag && !state)
        );
      };

      const scanElements = async (elements, threshold, highlightStyle) => {
        if (abortScanning) {
          return;
        }

        const sentenceEntries = [];
        const elementStates = new Map();

        for (const element of elements) {
          if (abortScanning) {
            break;
          }

          const rawText = element.textContent ?? '';
          const cleanText = sanitizeText(rawText);
          const signature = buildSignature(element, cleanText);

          if (!cleanText || shouldSkip(element, cleanText, signature)) {
            continue;
          }

          const sentences = splitIntoSentences(rawText);
          if (sentences.length === 0) {
            setScanState(element, PROCESSED_FLAG);
            processedSignatures.add(signature);
            continue;
          }

          const state = {
            element,
            signature,
            flagged: [],
            sentences,
            style: highlightStyle
          };

          elementStates.set(signature, state);

          sentences.forEach((sentence) => {
            sentenceEntries.push({
              state,
              text: sentence.clean,
              raw: sentence.raw,
              start: sentence.start,
              end: sentence.end
            });
          });
        }

        if (sentenceEntries.length === 0) {
          if (activeBatchCount === 0) {
            notifyExtension('scan-complete', { active: activeBatchCount });
            emitEvent('deb-scan-complete', { active: activeBatchCount });
          }
          scheduleOverlayUpdate();
          return;
        }

        if (activeBatchCount === 0) {
          notifyExtension('scan-start', { batchSize: sentenceEntries.length });
          emitEvent('deb-scan-start', { batchSize: sentenceEntries.length });
        }

        activeBatchCount += 1;
        const progressDetail = { active: activeBatchCount, batchSize: sentenceEntries.length };
        emitEvent('deb-scan-progress', progressDetail);
        notifyExtension('scan-progress', progressDetail);

        try {
          const results = await fetchPredictionBatch(sentenceEntries.map((entry) => entry.text));

          sentenceEntries.forEach((entry, index) => {
            const result = results[index];
            if (!result) {
              return;
            }
            if (result.label === 'HATE' && typeof result.score === 'number' && result.score >= threshold) {
              entry.state.flagged.push({ entry, result });
            }
          });

          elementStates.forEach((state) => {
            const { element, signature, flagged, style } = state;
            const seenRanges = new Map();

            flagged.forEach((item) => {
              const { entry, result } = item;
              const key = `${entry.start}:${entry.end}`;
              if (!seenRanges.has(key)) {
                seenRanges.set(key, item);
                return;
              }
              const existing = seenRanges.get(key);
              const existingScore = Number(existing?.result?.score) || 0;
              const incomingScore = Number(result?.score) || 0;
              if (incomingScore > existingScore) {
                seenRanges.set(key, item);
              }
            });

            const uniqueFlagged = Array.from(seenRanges.values());
            uniqueFlagged.sort((a, b) => a.entry.start - b.entry.start);
            state.flagged = uniqueFlagged;

            removeHighlight(element);

            const wrappers = [];
            const snippets = [];
            let maxScore = 0;

            if (uniqueFlagged.length > 0) {
              uniqueFlagged.forEach(({ entry, result }) => {
                const wrapper = highlightRange(element, entry.start, entry.end, style);
                if (!wrapper) {
                  return;
                }
                wrappers.push(wrapper);
                snippets.push(entry.text);
                maxScore = Math.max(maxScore, Number(result?.score) || 0);
              });
            }

            if (wrappers.length > 0) {
              const payload = {
                label: 'HATE',
                score: maxScore,
                count: style === 'highlight' ? wrappers.length : uniqueFlagged.length
              };
              attachFeedback(element, payload, wrappers, snippets, style, signature);
            }

            setScanState(element, PROCESSED_FLAG);
            element.dataset.debSignature = signature;
            processedSignatures.add(signature);
          });
        } catch (error) {
          abortScanning = true;
          console.error('[Sentinel] Batch prediction failed:', error);
          notifyExtension('scan-error', { message: error?.message ?? 'Unknown error' });
          elementStates.forEach(({ element }) => {
            delete element.dataset.debScanState;
            delete element.dataset.scanned;
            removeHighlight(element);
          });
        } finally {
          activeBatchCount = Math.max(0, activeBatchCount - 1);
          const finalDetail = { active: activeBatchCount };
          emitEvent('deb-scan-progress', finalDetail);
          notifyExtension(activeBatchCount === 0 ? 'scan-complete' : 'scan-progress', finalDetail);
          scheduleOverlayUpdate();
        }
      };

      const collectTargetsFromNode = (node, set) => {
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return;
        }

        const maybeAdd = (element) => {
          const target = findHighlightTarget(element);
          if (target && !set.has(target)) {
            set.add(target);
          }
        };

        maybeAdd(node);

        const selector = BASE_SCAN_SELECTOR;
        const nested = selector ? node.querySelectorAll?.(selector) : null;
        if (nested?.length) {
          nested.forEach((el) => maybeAdd(el));
        }
      };

      if (!document.body) {
        await new Promise((resolve) => {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
          } else {
            resolve();
          }
        });
      }

      ensureStyles();

      const { threshold, highlightStyle } = await loadSettings();
      await initializePendingFeedback();

      const initialTargets = new Set();
      collectTargetsFromNode(document.body, initialTargets);
      await scanElements(initialTargets, threshold, highlightStyle);

      if (abortScanning) {
        clearAll();
        scheduleOverlayUpdate();
        return;
      }

      const observer = new MutationObserver((mutations) => {
        if (abortScanning) {
          return;
        }

        const freshTargets = new Set();

        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => collectTargetsFromNode(node, freshTargets));
        });

        if (freshTargets.size === 0) {
          return;
        }

        scanElements(freshTargets, threshold, highlightStyle).catch((error) =>
          console.error('[Sentinel] Error scanning new nodes:', error)
        );
      });

      observer.observe(document.body, { childList: true, subtree: true });

      emitEvent('deb-scan-complete', { active: activeBatchCount });
      notifyExtension('scan-complete', { active: activeBatchCount });
    } catch (error) {
      console.error('[Sentinel] Scanner initialization failed:', error);
      window.__sentinelScannerActive = false;
    }
})();
}
})();
