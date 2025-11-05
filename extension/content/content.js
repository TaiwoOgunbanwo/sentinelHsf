(() => {
  if (chrome?.runtime?.onMessage && !window.__sentinelStopListenerRegistered) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || message.source !== 'deb-background' || message.type !== 'stop-auto-scan') {
        return;
      }
      if (typeof window.__sentinelStopContinuousScan === 'function') {
        window.__sentinelStopContinuousScan();
      } else {
        window.__sentinelStopRequested = true;
      }
    });
    window.__sentinelStopListenerRegistered = true;
  }
  const createOverlayManagerFallback = () => ({
    ensureStyles: () => {},
    scheduleOverlayUpdate: () => {},
    removeHighlight: () => {},
    attachFeedback: () => {},
    clearAll: () => {}
  });

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

  const fetchWithFallback = async (path, payload, options = {}) =>
    sendBackgroundRequest({ type: 'proxy-fetch', path, payload, context: options.context ?? 'scan' });

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

      const fetchPredictionSingle = async (text) => fetchWithFallback('/predict', { text }, { context: 'scan' });

      const fetchPredictionBatch = async (texts) => {
        if (!Array.isArray(texts) || texts.length === 0) {
          return [];
        }

        try {
          const response = await fetchWithFallback('/predict/batch', { texts }, { context: 'scan' });
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
        let flaggedElementCount = 0;
        let flaggedSegmentCount = 0;

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
          if (activeBatchCount === 0 && !abortScanning) {
            const completionDetail = {
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
            };
            notifyExtension('scan-complete', completionDetail);
            emitEvent('deb-scan-complete', completionDetail);
          }
          chrome.runtime.sendMessage({
            source: 'deb-telemetry',
            type: 'scan-summary',
            detail: {
              threshold,
              style: highlightStyle,
              processedElements: 0,
              flaggedElements: 0,
              flaggedSegments: 0,
              totalSentences: 0,
              timestamp: Date.now()
            }
          });
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

        let lastSummary = null;

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
          const summary = {
            threshold,
            style: highlightStyle,
            processedElements: elementStates.size,
            flaggedElements: flaggedElementCount,
            flaggedSegments: flaggedSegmentCount,
            totalSentences: sentenceEntries.length,
            batchSize: results.length,
            timestamp: Date.now()
          };
          lastSummary = summary;
          chrome.runtime.sendMessage({ source: 'deb-telemetry', type: 'scan-summary', detail: summary });
        } catch (error) {
          abortScanning = true;
          console.error('[Sentinel] Batch prediction failed:', error);
          notifyExtension('scan-error', { message: error?.message ?? 'Unknown error' });
          chrome.runtime.sendMessage({
            source: 'deb-telemetry',
            type: 'scan-error',
            detail: {
              threshold,
              style: highlightStyle,
              message: error?.message ?? 'Unknown error'
            }
          });
          elementStates.forEach(({ element }) => {
            delete element.dataset.debScanState;
            delete element.dataset.scanned;
            removeHighlight(element);
          });
        } finally {
          activeBatchCount = Math.max(0, activeBatchCount - 1);
          const finalDetail = { active: activeBatchCount };
          emitEvent('deb-scan-progress', finalDetail);
          if (activeBatchCount === 0 && !abortScanning) {
            const completionDetail = {
              active: activeBatchCount,
              flaggedElements: flaggedElementCount,
              flaggedSegments: flaggedSegmentCount
            };
            if (lastSummary) {
              completionDetail.summary = lastSummary;
            } else {
              completionDetail.summary = {
                threshold,
                style: highlightStyle,
                processedElements: elementStates.size,
                flaggedElements: flaggedElementCount,
                flaggedSegments: flaggedSegmentCount,
                totalSentences: sentenceEntries.length,
                batchSize: sentenceEntries.length,
                timestamp: Date.now()
              };
            }
            notifyExtension('scan-complete', completionDetail);
            emitEvent('deb-scan-complete', completionDetail);
          } else {
            notifyExtension('scan-progress', finalDetail);
          }
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

      const pendingMutationTargets = new Set();
      let mutationTimer = null;
      let mutationObserver = null;
      const MUTATION_DEBOUNCE_MS = 300;

      const stopContinuousScan = (options = {}) => {
        if (mutationTimer) {
          clearTimeout(mutationTimer);
          mutationTimer = null;
        }
        pendingMutationTargets.clear();
        if (mutationObserver) {
          mutationObserver.disconnect();
          mutationObserver = null;
        }
        abortScanning = true;
        if (options.resetHighlights) {
          clearAll();
          scheduleOverlayUpdate();
        }
        if (options.notify !== false) {
          notifyExtension('scan-stopped', { reason: options.reason || 'auto-scan-disabled' });
        }
        if (chrome?.runtime?.sendMessage) {
          chrome.runtime.sendMessage(
            {
              source: 'deb-telemetry',
              type: 'scan-stopped',
              detail: {
                reason: options.reason || 'auto-scan-disabled',
                timestamp: Date.now()
              }
            },
            () => {
              if (chrome.runtime?.lastError && !chrome.runtime.lastError.message?.includes('Receiving end does not exist')) {
                console.warn('[Sentinel] Failed to report scan stop:', chrome.runtime.lastError);
              }
            }
          );
        }
        window.__sentinelScannerActive = false;
      };

      window.__sentinelStopContinuousScan = stopContinuousScan;
      if (window.__sentinelStopRequested) {
        stopContinuousScan({ notify: false });
        window.__sentinelStopRequested = false;
        return;
      }

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

      emitEvent('deb-scan-complete', { active: activeBatchCount });
      notifyExtension('scan-complete', { active: activeBatchCount });
    } catch (error) {
      console.error('[Sentinel] Scanner initialization failed:', error);
      window.__sentinelScannerActive = false;
    }
})();
}
})();
