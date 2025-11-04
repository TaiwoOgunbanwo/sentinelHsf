import { CONFIG } from './config.js';

const AUTO_SCAN_KEY = 'autoScanEnabled';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DEFAULT_HTTP_BASES = ['http://localhost:5000'];
const FETCH_RETRY_DELAYS_MS = [0, 800];

const API_KEY_HEADER = CONFIG.API_KEY ? { 'X-API-Key': CONFIG.API_KEY } : {};
const API_BASES = (() => {
  const list = Array.isArray(CONFIG.API_BASES) ? [...CONFIG.API_BASES] : ['https://localhost:5000'];
  if (!list.some((base) => base.startsWith('http://'))) {
    list.push(...DEFAULT_HTTP_BASES);
  }
  return list;
})();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const telemetry = {
  autoScanEnabled: false,
  lastFetch: null,
  lastScan: null,
  lastInjectionError: null
};

const notifyClients = (type, detail = {}) => {
  try {
    chrome.runtime.sendMessage({ source: 'deb-background', type, detail });
  } catch (error) {
    // Ignore missing listeners
  }
};

const broadcastTelemetry = () => {
  notifyClients('telemetry-update', {
    telemetry: JSON.parse(JSON.stringify(telemetry))
  });
};

let autoScanEnabled = false;

const readAutoScanSetting = async () => {
  try {
    const stored = await chrome.storage.sync.get([AUTO_SCAN_KEY]);
    autoScanEnabled = Boolean(stored?.[AUTO_SCAN_KEY]);
    telemetry.autoScanEnabled = autoScanEnabled;
    broadcastTelemetry();
  } catch (error) {
    console.warn('[Sentinel] Failed to read auto-scan setting.', error);
    autoScanEnabled = false;
    telemetry.autoScanEnabled = false;
    broadcastTelemetry();
  }
};

const isInjectableTab = (tab) => {
  if (!tab?.url) {
    return false;
  }
  try {
    const { protocol } = new URL(tab.url);
    return ALLOWED_PROTOCOLS.has(protocol);
  } catch (error) {
    return false;
  }
};

const injectScanner = async (tabId) => {
  if (!autoScanEnabled) {
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['extension/content/content.js']
    });
  } catch (error) {
    console.warn('[Sentinel] Auto-scan injection failed:', error);
    telemetry.lastInjectionError = {
      tabId,
      message: error?.message || 'Injection failed',
      timestamp: Date.now()
    };
    broadcastTelemetry();
    notifyClients('auto-scan-injection-failed', {
      tabId,
      error: error?.message || 'Injection failed'
    });
  }
};

const handleTabUpdated = (tabId, changeInfo, tab) => {
  if (!autoScanEnabled || changeInfo.status !== 'complete') {
    return;
  }
  if (!isInjectableTab(tab)) {
    return;
  }
  injectScanner(tabId);
};

const handleTabActivated = async (activeInfo) => {
  if (!autoScanEnabled) {
    return;
  }
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (isInjectableTab(tab)) {
      await injectScanner(tab.id);
    }
  } catch (error) {
    console.warn('[Sentinel] Unable to access active tab for auto-scan.', error);
  }
};

chrome.tabs.onUpdated.addListener(handleTabUpdated);
chrome.tabs.onActivated.addListener(handleTabActivated);

const fetchFromApi = async (path, payload, context = 'scan') => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    notifyClients('background-fetch-offline', { path, context });
    telemetry.lastFetch = {
      ok: false,
      offline: true,
      path,
      context,
      timestamp: Date.now()
    };
    broadcastTelemetry();
    throw new Error('Offline');
  }

  const body = payload != null ? JSON.stringify(payload) : undefined;
  const attempts = [];
  const startTime = Date.now();

  for (const base of API_BASES) {
    for (let attemptIndex = 0; attemptIndex < FETCH_RETRY_DELAYS_MS.length; attemptIndex += 1) {
      const delayMs = FETCH_RETRY_DELAYS_MS[attemptIndex];
      if (delayMs > 0) {
        await delay(delayMs);
      }

      try {
        const response = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...API_KEY_HEADER
          },
          body
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ''}`);
        }

        const data = await response.json();
        telemetry.lastFetch = {
          ok: true,
          path,
          context,
          base,
          durationMs: Date.now() - startTime,
          attempts: attempts.length + 1,
          timestamp: Date.now()
        };
        broadcastTelemetry();
        return data;
      } catch (error) {
        attempts.push({
          base,
          attempt: attemptIndex + 1,
          message: error?.message || 'Request failed'
        });
      }
    }
  }

  notifyClients('background-fetch-failed', { path, context, attempts });
  const summary = attempts
    .map((info) => `${info.base} (attempt ${info.attempt}): ${info.message}`)
    .join('; ');
  telemetry.lastFetch = {
    ok: false,
    path,
    context,
    attempts,
    timestamp: Date.now()
  };
  broadcastTelemetry();
  throw new Error(`Failed to fetch ${path}: ${summary}`);
};

const SUPPORTED_SCANNER_REQUESTS = new Set(['predict-single', 'predict-batch', 'proxy-fetch']);

const handleScannerMessage = async (message) => {
  const context = message.context ?? 'scan';
  switch (message.type) {
    case 'predict-single':
      if (typeof message.text !== 'string' || !message.text.trim()) {
        throw new Error('Invalid or empty text payload.');
      }
      return fetchFromApi('/predict', { text: message.text }, context);
    case 'predict-batch':
      if (!Array.isArray(message.texts) || message.texts.length === 0) {
        throw new Error('`texts` must be a non-empty array.');
      }
      return fetchFromApi('/predict/batch', { texts: message.texts }, context);
    case 'proxy-fetch':
      if (typeof message.path !== 'string' || !message.path.startsWith('/')) {
        throw new Error('A valid relative `path` is required.');
      }
      return fetchFromApi(message.path, message.payload ?? null, context);
    default:
      return null;
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return undefined;
  }

  if (message.source === 'deb-popup' && message.type === 'auto-scan-updated') {
    autoScanEnabled = Boolean(message.enabled);
    telemetry.autoScanEnabled = autoScanEnabled;
    chrome.storage.sync.set({ [AUTO_SCAN_KEY]: autoScanEnabled }).catch((error) => {
      console.warn('[Sentinel] Failed to persist auto-scan setting.', error);
    });

    if (autoScanEnabled && message.injectCurrentTab) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (tab && isInjectableTab(tab)) {
          injectScanner(tab.id);
        }
      });
    }
    sendResponse?.({ ok: true });
    broadcastTelemetry();
    return false;
  }

  if (message.source === 'deb-popup' && message.type === 'telemetry-request') {
    sendResponse?.({ ok: true, telemetry: JSON.parse(JSON.stringify(telemetry)) });
    return false;
  }

  if (message.source === 'deb-telemetry') {
    if (message.type === 'scan-summary' && message.detail) {
      telemetry.lastScan = {
        ...message.detail,
        timestamp: Date.now()
      };
      broadcastTelemetry();
    }
    if (message.type === 'scan-error' && message.detail) {
      telemetry.lastScan = {
        ...message.detail,
        error: true,
        timestamp: Date.now()
      };
      broadcastTelemetry();
    }
    sendResponse?.({ ok: true });
    return false;
  }

  if (message.source === 'deb-scanner') {
    if (!SUPPORTED_SCANNER_REQUESTS.has(message.type)) {
      return false;
    }
    handleScannerMessage(message)
      .then((data) => sendResponse?.({ ok: true, data }))
      .catch((error) => {
        console.warn('[Sentinel] Background prediction failed:', error);
        sendResponse?.({ ok: false, error: error?.message || 'Prediction failed.' });
      });
    return true; // keep the channel open for async response
  }

  return undefined;
});

chrome.runtime.onInstalled.addListener(() => {
  readAutoScanSetting();
});

chrome.runtime.onStartup.addListener(() => {
  readAutoScanSetting();
});

readAutoScanSetting();
