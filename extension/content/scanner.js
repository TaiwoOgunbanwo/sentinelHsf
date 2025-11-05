const createDelay = () => (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const startScanner = async ({
  config,
  createDomHelpers,
  createFeedbackManager,
  createOverlayManager,
  apiClient,
  notifyExtension,
  emitEvent,
  onStop
}) => {
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
  } = config;

  const storageLocal = chrome?.storage?.local ?? null;
  const processedSignatures = new Set();
  let activeBatchCount = 0;
  let abortScanning = false;

  const delay = createDelay();

  const fetchWithFallback = (path, payload, options = {}) =>
    apiClient.proxy(path, payload, options);

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
      highlightRange,
      unwrapWrappers
    },
    feedback: {
      addHistoryEntry: addFeedbackHistoryEntry,
      queueReport: queueFeedbackReport,
      sendPayload: sendFeedbackPayload,
      schedulePendingFlush
    },
    notifyExtension,
    processedSignatures,
    setScanState,
    flags: {
      dismissed: DISMISSED_FLAG
    },
    defaultStyle: DEFAULT_STYLE
  });

  const notifyScan = (type, detail = {}) => {
    notifyExtension(type, detail);
    emitEvent(`deb-${type.replace(/_/g, '-')}`, detail);
  };

  const sendPredictionBatch = (texts, options = {}) =>
    apiClient.send({
      type: 'predict-batch',
      texts,
      context: options.context ?? 'scan'
    });

  const sendPredictionSingle = (text, options = {}) =>
    apiClient.send({
      type: 'predict-single',
      text,
      context: options.context ?? 'scan'
    });

  const stopContinuousScan = (options = {}) => {
    abortScanning = true;
    scheduleOverlayUpdate();
    if (options.resetHighlights) {
      clearAll();
    }
    notifyScan('scan-stopped', {
      reason: options.reason || 'auto-scan-disabled',
      timestamp: Date.now()
    });
    if (typeof onStop === 'function') {
      onStop(options);
    }
  };

  const loadInitialContext = async () => {
    ensureStyles();
    const { threshold, highlightStyle } = await loadSettings();
    await initializePendingFeedback();
    return { threshold, highlightStyle };
  };

  const scanElements = async (elements, threshold, highlightStyle) => {
    if (!elements?.size || abortScanning) {
      return;
    }

    const sentenceEntries = [];
    const elementStates = new Map();
    let flaggedElementCount = 0;
    let flaggedSegmentCount = 0;

    elements.forEach((element) => {
      if (!element || element.dataset.debScanState === PROCESSED_FLAG) {
        return;
      }

      const signature = buildSignature(element);
      if (!signature || processedSignatures.has(signature)) {
        return;
      }

      const rawText = sanitizeText(element.innerText);
      if (!rawText) {
        processedSignatures.add(signature);
        return;
      }

      const sentences = splitIntoSentences(rawText);
      if (sentences.length === 0) {
        setScanState(element, PROCESSED_FLAG);
        processedSignatures.add(signature);
        return;
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
    });

    if (sentenceEntries.length === 0) {
      if (activeBatchCount === 0 && !abortScanning) {
        notifyScan('scan-complete', {
          active: activeBatchCount,
          flaggedElements: 0,
          flaggedSegments: 0,
          summary: {
            threshold,
            style: highlightStyle,
            processedElements: 0,
            flaggedElements: 0,
            flaggedSegments: 0,
            totalSentences: 0,
            batchSize: 0,
            timestamp: Date.now()
          }
        });
      }
      return;
    }

    if (activeBatchCount === 0) {
      notifyScan('scan-start', { batchSize: sentenceEntries.length });
    }

    activeBatchCount += 1;
    notifyScan('scan-progress', { active: activeBatchCount, batchSize: sentenceEntries.length });

    let lastSummary = null;

    try {
      const results = await sendPredictionBatch(sentenceEntries.map((entry) => entry.text));

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
          flaggedElementCount += 1;
          flaggedSegmentCount += wrappers.length;
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

      lastSummary = {
        threshold,
        style: highlightStyle,
        processedElements: elementStates.size,
        flaggedElements: flaggedElementCount,
        flaggedSegments: flaggedSegmentCount,
        totalSentences: sentenceEntries.length,
        batchSize: results.length,
        timestamp: Date.now()
      };

      notifyExtension('telemetry-update', {
        telemetry: {
          lastScan: lastSummary
        }
      });
    } catch (error) {
      abortScanning = true;
      console.error('[Sentinel] Batch prediction failed:', error);
      notifyScan('scan-error', { message: error?.message ?? 'Unknown error' });
      elementStates.forEach(({ element }) => {
        delete element.dataset.debScanState;
        delete element.dataset.scanned;
        removeHighlight(element);
      });
    } finally {
      activeBatchCount = Math.max(0, activeBatchCount - 1);
      if (activeBatchCount === 0 && !abortScanning) {
        notifyScan('scan-complete', {
          active: activeBatchCount,
          flaggedElements: flaggedElementCount,
          flaggedSegments: flaggedSegmentCount,
          summary:
            lastSummary ??
            {
              threshold,
              style: highlightStyle,
              processedElements: elementStates.size,
              flaggedElements: flaggedElementCount,
              flaggedSegments: flaggedSegmentCount,
              totalSentences: sentenceEntries.length,
              batchSize: sentenceEntries.length,
              timestamp: Date.now()
            }
        });
      } else {
        notifyScan('scan-progress', { active: activeBatchCount });
      }
      scheduleOverlayUpdate();
    }
  };

  const collectTargetsFromNode = (node, set) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
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

  const initialize = async () => {
    if (!document.body) {
      await new Promise((resolve) => {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
        } else {
          resolve();
        }
      });
    }

    const { threshold, highlightStyle } = await loadInitialContext();

    const pendingMutationTargets = new Set();
    let mutationTimer = null;
    let mutationObserver = null;
    const MUTATION_DEBOUNCE_MS = 300;

    const flushMutationQueue = () => {
      mutationTimer = null;
      if (pendingMutationTargets.size === 0 || abortScanning) {
        pendingMutationTargets.clear();
        return;
      }
      const targets = new Set(pendingMutationTargets);
      pendingMutationTargets.clear();
      scanElements(targets, threshold, highlightStyle).catch((error) =>
        console.error('[Sentinel] Error scanning queued nodes:', error)
      );
    };

    const scheduleMutationScan = (targets) => {
      targets.forEach((target) => pendingMutationTargets.add(target));
      if (mutationTimer) {
        clearTimeout(mutationTimer);
      }
      mutationTimer = setTimeout(flushMutationQueue, MUTATION_DEBOUNCE_MS);
    };

    const initialTargets = new Set();
    collectTargetsFromNode(document.body, initialTargets);
    await scanElements(initialTargets, threshold, highlightStyle);

    if (abortScanning) {
      clearAll();
      scheduleOverlayUpdate();
      return;
    }

    mutationObserver = new MutationObserver((mutations) => {
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

      scheduleMutationScan(freshTargets);
    });

    mutationObserver.observe(document.body, { childList: true, subtree: true });

    const stop = (options = {}) => {
      if (mutationTimer) {
        clearTimeout(mutationTimer);
        mutationTimer = null;
      }
      pendingMutationTargets.clear();
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
      stopContinuousScan(options);
    };

    window.__sentinelStopContinuousScan = stop;
    return stop;
  };

  return initialize();
};

export { startScanner };
