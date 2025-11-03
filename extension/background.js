const AUTO_SCAN_KEY = 'autoScanEnabled';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.source !== 'deb-popup') {
    return;
  }

  if (message.type === 'auto-scan-updated') {
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
    if (sendResponse) {
      sendResponse({ ok: true });
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  readAutoScanSetting();
});

chrome.runtime.onStartup.addListener(() => {
  readAutoScanSetting();
});

readAutoScanSetting();
