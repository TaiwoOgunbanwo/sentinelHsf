if (window.__sentinelScannerActive) {
  console.info('[Sentinel] scanner already running on this page.');
} else {
  window.__sentinelScannerActive = true;
(async () => {
  const { CONFIG } = await import(chrome.runtime.getURL('extension/config.js'));
  const { createFeedbackManager } = await import(chrome.runtime.getURL('extension/content/feedback.js'));
  const { createDomHelpers } = await import(chrome.runtime.getURL('extension/content/dom.js'));
  const {
    API_KEY,
    API_BASES,
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
    FEEDBACK_PREFIX,
    STORAGE_KEYS,
    MAX_FEEDBACK_HISTORY,
    FEEDBACK_RETRY_ATTEMPTS,
    FEEDBACK_RETRY_DELAYS
  } = CONFIG;
  const storageLocal = chrome?.storage?.local ?? null;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const {
    sanitizeText,
    pickPreferredDescendant,
    findHighlightTarget,
    splitIntoSentences,
    makeRedactLabel,
    collectTextNodes,
    findPositionInNodes,
    highlightRange,
    unwrapWrappers,
    resolveStableIdentifier,
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

  const overlayRegistry = new Map();
  const processedSignatures = new Set();
  let overlayListenersActive = false;
  let overlayUpdateQueued = false;
  let abortScanning = false;
  let activeBatchCount = 0;

  const notifyExtension = (type, detail = {}) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ source: 'deb-scanner', type, detail }, () => {
          // Swallow absent listeners
          if (chrome.runtime?.lastError) {
            return;
          }
        });
      }
    } catch (error) {
      // ignore messaging failures
    }
  };

  const emitEvent = (name, detail = {}) => {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (error) {
      // ignore environments where dispatching fails
    }
  };

  const ensureStyles = () => {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        position: relative;
      }
      .${INLINE_HIGHLIGHT_CLASS} {
        position: relative;
        display: inline-block;
        padding: 0 2px;
        border-radius: 6px;
        transition: background 0.2s ease, filter 0.2s ease, color 0.2s ease, text-shadow 0.2s ease;
      }
      .${INLINE_HIGHLIGHT_CLASS}--highlight {
        background: linear-gradient(120deg, rgba(223, 41, 53, 0.18), rgba(223, 41, 53, 0.08));
        color: inherit;
        box-shadow: 0 2px 10px rgba(223, 41, 53, 0.25);
      }
      .${INLINE_HIGHLIGHT_CLASS}--highlight:hover {
        box-shadow: 0 3px 14px rgba(223, 41, 53, 0.35);
        background: linear-gradient(120deg, rgba(223, 41, 53, 0.28), rgba(223, 41, 53, 0.12));
      }
      .${INLINE_HIGHLIGHT_CLASS}--blur {
        filter: blur(6px);
        cursor: pointer;
      }
      .${INLINE_HIGHLIGHT_CLASS}--blur[data-revealed="true"] {
        filter: none;
      }
      .${INLINE_HIGHLIGHT_CLASS}--redact {
        color: transparent;
        background: rgba(17, 24, 39, 0.92);
        cursor: pointer;
      }
      .${INLINE_HIGHLIGHT_CLASS}--redact::after {
        content: attr(data-redact);
        color: #f9fafb;
        letter-spacing: 0.12em;
        font-size: 0.75em;
        opacity: 0.85;
        display: inline-block;
        vertical-align: middle;
      }
      .${INLINE_HIGHLIGHT_CLASS}--redact[data-revealed="true"] {
        color: inherit;
        background: rgba(223, 41, 53, 0.12);
      }
      .${INLINE_HIGHLIGHT_CLASS}--redact[data-revealed="true"]::after {
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
      .${TOOLTIP_CLASS} {
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
      .${TOOLTIP_CLASS}::after {
        content: '';
        position: absolute;
        bottom: -8px;
        right: 18px;
        border-width: 8px 8px 0 8px;
        border-style: solid;
        border-color: rgba(17, 24, 39, 0.92) transparent transparent transparent;
        filter: drop-shadow(0 2px 4px rgba(17, 24, 39, 0.25));
      }
      .${TOOLTIP_CLASS} * {
        box-sizing: border-box;
      }
      .${TOOLTIP_META_CLASS} {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .${TOOLTIP_BADGE_CLASS} {
        background: #df2935;
        color: #ffffff;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-weight: 600;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 999px;
        display: inline-block;
        width: fit-content;
      }
      .${TOOLTIP_SCORE_CLASS} {
        opacity: 0.7;
        font-size: 11px;
      }
      .${TOOLTIP_ACTIONS_CLASS} {
        display: grid;
        grid-auto-flow: column;
        gap: 6px;
      }
      .${TOOLTIP_BUTTON_CLASS} {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.4);
        border-radius: 6px;
        color: #ffffff;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 11px;
        transition: background 0.18s ease, border-color 0.18s ease;
      }
      .${TOOLTIP_BUTTON_CLASS}:hover {
        background: rgba(223, 41, 53, 0.2);
        border-color: rgba(223, 41, 53, 0.8);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };


  const setScanState = (el, state) => {
    el.dataset.debScanState = state;
    if (state === PROCESSED_FLAG) {
      el.dataset.scanned = 'true';
    }
  };

  const loadSettings = async () => {
    let threshold = DEFAULT_THRESHOLD;
    let highlightStyle = DEFAULT_STYLE;

    try {
      const stored = await chrome.storage.sync.get(['sensitivity', 'highlightStyle']);
      const value = parseFloat(stored?.sensitivity);
      if (Number.isFinite(value)) {
        threshold = value;
      }

      if (typeof stored?.highlightStyle === 'string' && HIGHLIGHT_STYLE_OPTIONS.includes(stored.highlightStyle)) {
        highlightStyle = stored.highlightStyle;
      }
    } catch (error) {
      console.warn('Unable to read settings from storage. Using defaults.', error);
    }

    return { threshold, highlightStyle };
  };

async function fetchWithFallback(path, payload) {
  let lastError;

  for (const base of API_BASES) {
    const endpoint = `${base}${path}`;
      const headers = {
        'Content-Type': 'application/json'
      };
      if (API_KEY) {
        headers['X-API-Key'] = API_KEY;
      }
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        lastError = error;
        console.warn('Prediction request failed at', endpoint, error);
      }
    }

  throw lastError ?? new Error('Unable to reach prediction API.');
}

  const {
    addFeedbackHistoryEntry,
    updateFeedbackHistoryEntry,
    queueFeedbackReport,
    schedulePendingFlush,
    flushPendingFeedback,
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
      console.warn('Batch endpoint failed; falling back to single requests.', error);
      const singles = [];
      for (const text of texts) {
        singles.push(await fetchPredictionSingle(text));
      }
      return singles;
    }
  };

  const textSnippet = (text) => {
    if (!text) {
      return '';
    }
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  };

  const formatScore = (score) => (typeof score === 'number' ? score.toFixed(2) : 'n/a');

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
    el.classList.remove(HIGHLIGHT_CLASS);
    const entry = overlayRegistry.get(el);
    if (entry) {
      unwrapWrappers(entry.wrappers ?? []);
      entry.container?.remove?.();
      entry.control?.remove?.();
      overlayRegistry.delete(el);
      scheduleOverlayUpdate();
    } else {
      unwrapWrappers(Array.from(el.querySelectorAll(`.${INLINE_HIGHLIGHT_CLASS}`)));
    }
  };

  const attachFeedback = (el, result = {}, wrappers = [], snippets = [], style = DEFAULT_STYLE, signature) => {
    const existing = overlayRegistry.get(el);
    if (existing) {
      unwrapWrappers(existing.wrappers ?? []);
      existing.container?.remove?.();
      existing.control?.remove?.();
      overlayRegistry.delete(el);
    }

    const rawScore = typeof result?.score === 'number' ? Number(result.score) : null;
    const scoreText = formatScore(rawScore ?? 0);
    const feedbackText = (snippets.length ? snippets.join(' ') : sanitizeText(el.innerText)).slice(0, 4000);

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
        const queued = await queueFeedbackReport({
          id: historyId,
          payload,
          history: baseHistory,
          retries: 0,
          lastError: message
        });
        if (queued) {
          await addFeedbackHistoryEntry({
            ...baseHistory,
            status: 'queued',
            queuedAt: Date.now(),
            lastError: message
          });
          notifyExtension('feedback-queued', { entryId: historyId });
          button.textContent = 'Queued';
          return false;
        }

        console.error('Failed to queue feedback:', message);
        button.disabled = false;
        button.textContent = originalLabel || 'Retry';
        notifyExtension('feedback-error', { entryId: historyId, message });
        return false;
      };

      if (offline) {
        return queueReport('Offline');
      }

      try {
        await sendFeedbackPayload(payload);

        await addFeedbackHistoryEntry({
          ...baseHistory,
          status: 'sent',
          sentAt: Date.now()
        });

        notifyExtension('feedback-sent', { entryId: historyId });

        if (action === 'dismiss') {
          if (signature) {
            processedSignatures.delete(signature);
          }
          setScanState(el, DISMISSED_FLAG);
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

      const normalizedSnippets = snippets.length ? snippets : [sanitizeText(el.innerText)];

      wrappers.forEach((wrapper, index) => {
        const snippet = normalizedSnippets[index] ?? normalizedSnippets[normalizedSnippets.length - 1] ?? '';
        wrapper.dataset.revealed = wrapper.dataset.revealed ?? 'false';
        if (style === 'redact') {
          wrapper.dataset.redact = makeRedactLabel(snippet);
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
      el.classList.add(HIGHLIGHT_CLASS);
      return;
    }

    const container = document.createElement('div');
    container.className = TOOLTIP_CLASS;
    container.style.visibility = 'hidden';
    const countLabel = result?.count && result.count > 1 ? `${result.label ?? 'HATE'} • ${result.count}` : result?.label ?? 'HATE';
    container.innerHTML = `
      <div class="${TOOLTIP_META_CLASS}">
        <span class="${TOOLTIP_BADGE_CLASS}">${countLabel}</span>
        <span class="${TOOLTIP_SCORE_CLASS}">Score: ${scoreText}</span>
      </div>
      <div class="${TOOLTIP_ACTIONS_CLASS}">
        <button type="button" class="${TOOLTIP_BUTTON_CLASS}" data-action="dismiss">Not hate?</button>
        <button type="button" class="${TOOLTIP_BUTTON_CLASS}" data-action="flag">Flag</button>
      </div>
    `;

    container.querySelectorAll(`.${TOOLTIP_BUTTON_CLASS}`).forEach((button) => {
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
    el.classList.add(HIGHLIGHT_CLASS);
    el.dataset.debFeedbackAttached = 'true';
    scheduleOverlayUpdate();
    requestAnimationFrame(scheduleOverlayUpdate);
  };

  const shouldSkip = (el, text, signature) => {
    const legacyFlag = el.dataset.scanned === 'true';
    const state = el.dataset.debScanState;
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

    for (const el of elements) {
      if (abortScanning) {
        break;
      }

      const rawText = el.textContent ?? '';
      const cleanText = sanitizeText(rawText);
      const signature = buildSignature(el, cleanText);

      if (!cleanText || shouldSkip(el, cleanText, signature)) {
        continue;
      }

      const sentences = splitIntoSentences(rawText);
      if (sentences.length === 0) {
        setScanState(el, PROCESSED_FLAG);
        processedSignatures.add(signature);
        continue;
      }

      const state = {
        element: el,
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
        } else {
          overlayRegistry.delete(element);
        }

        setScanState(element, PROCESSED_FLAG);
        element.dataset.debSignature = signature;
        processedSignatures.add(signature);
      });

    } catch (error) {
      abortScanning = true;
      console.error('Batch prediction failed:', error);
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
    overlayRegistry.clear();
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

    scanElements(freshTargets, threshold, highlightStyle).catch((error) => console.error('Error scanning new nodes:', error));
  });

  observer.observe(document.body, { childList: true, subtree: true });

  emitEvent('deb-scan-complete', { active: activeBatchCount });
  notifyExtension('scan-complete', { active: activeBatchCount });
})();
}
