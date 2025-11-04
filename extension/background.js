import { CONFIG } from './config.js';

const AUTO_SCAN_KEY = 'autoScanEnabled';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DEFAULT_HTTP_BASES = ['http://localhost:5000'];

const API_KEY_HEADER = CONFIG.API_KEY ? { 'X-API-Key': CONFIG.API_KEY } : {};
const API_BASES = (() => {
  const list = Array.isArray(CONFIG.API_BASES) ? [...CONFIG.API_BASES] : ['https://localhost:5000'];
  if (!list.some((base) => base.startsWith('http://'))) {
    list.push(...DEFAULT_HTTP_BASES);
  }
  return list;
})();

let autoScanEnabled = false;

const readAutoScanSetting = async () => {
  try {
    const stored = await chrome.storage.sync.get([AUTO_SCAN_KEY]);
    autoScanEnabled = Boolean(stored?.[AUTO_SCAN_KEY]);
  } catch (error) {
    console.warn('[Sentinel] Failed to read auto-scan setting.', error);
    autoScanEnabled = false;
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

const fetchFromApi = async (path, payload) => {
  const body = payload != null ? JSON.stringify(payload) : undefined;
  let lastError;
  for (const base of API_BASES) {
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
        const message = `HTTP ${response.status}`;
        lastError = new Error(message);
        continue;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('All API bases failed.');
};

const SUPPORTED_SCANNER_REQUESTS = new Set(['predict-single', 'predict-batch', 'proxy-fetch']);

const handleScannerMessage = async (message) => {
  switch (message.type) {
    case 'predict-single':
      if (typeof message.text !== 'string' || !message.text.trim()) {
        throw new Error('Invalid or empty text payload.');
      }
      return fetchFromApi('/predict', { text: message.text });
    case 'predict-batch':
      if (!Array.isArray(message.texts) || message.texts.length === 0) {
        throw new Error('`texts` must be a non-empty array.');
      }
      return fetchFromApi('/predict/batch', { texts: message.texts });
    case 'proxy-fetch':
      if (typeof message.path !== 'string' || !message.path.startsWith('/')) {
        throw new Error('A valid relative `path` is required.');
      }
      return fetchFromApi(message.path, message.payload ?? null);
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
