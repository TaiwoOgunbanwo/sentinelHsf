(() => {
  if (chrome?.runtime?.onMessage && !window.__sentinelStopListenerRegistered) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || message.source !== 'deb-background' || message.type !== 'stop-auto-scan') {
        return;
      }
      if (typeof window.__sentinelStopContinuousScan === 'function') {
        window.__sentinelStopContinuousScan({ reason: 'auto-scan-disabled', resetHighlights: false });
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

  if (window.__sentinelScannerActive) {
    console.info('[Sentinel] scanner already running on this page.');
    return;
  }

  window.__sentinelScannerActive = true;

  const bootstrap = async () => {
    try {
      const [
        { createApiClient },
        { startScanner },
        { CONFIG },
        { createFeedbackManager },
        { createDomHelpers }
      ] = await Promise.all([
        import(chrome.runtime.getURL('extension/content/api.js')),
        import(chrome.runtime.getURL('extension/content/scanner.js')),
        import(chrome.runtime.getURL('extension/config.js')),
        import(chrome.runtime.getURL('extension/content/feedback.js')),
        import(chrome.runtime.getURL('extension/content/dom.js'))
      ]);

      let createOverlayManager;
      try {
        const overlayModule = await import(
          /* @vite-ignore */ chrome.runtime.getURL('extension/content/overlay.js')
        );
        createOverlayManager = overlayModule?.createOverlayManager;
      } catch (error) {
        console.error('[Sentinel] Overlay module failed to load:', error);
      }

      const overlayFactory =
        typeof createOverlayManager === 'function' ? createOverlayManager : createOverlayManagerFallback;

      const apiClient = createApiClient();

      const stop = await startScanner({
        config: CONFIG,
        createDomHelpers,
        createFeedbackManager,
        createOverlayManager: overlayFactory,
        apiClient,
        notifyExtension,
        emitEvent,
        onStop: () => {
          window.__sentinelScannerActive = false;
        }
      });

      window.__sentinelStopContinuousScan =
        typeof stop === 'function'
          ? stop
          : () => {
              window.__sentinelScannerActive = false;
            };

      if (window.__sentinelStopRequested) {
        delete window.__sentinelStopRequested;
        window.__sentinelStopContinuousScan?.({ reason: 'auto-scan-disabled', resetHighlights: false });
      }
    } catch (error) {
      console.error('[Sentinel] Scanner initialization failed:', error);
      window.__sentinelScannerActive = false;
    }
  };

  bootstrap();
})();
