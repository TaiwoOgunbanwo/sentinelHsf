import { CONFIG } from '../config.js';

const sensitivityInput = document.getElementById('sensitivity');
const statusElement = document.getElementById('status');
const saveButton = document.getElementById('save');
const styleInputs = Array.from(document.querySelectorAll('input[name="highlightStyle"]'));
const siteListInput = document.getElementById('siteList');

const { STORAGE_KEYS } = CONFIG;

async function saveOptions() {
  if (!sensitivityInput || !statusElement || styleInputs.length === 0) {
    return;
  }

  const value = parseFloat(sensitivityInput.value);
  const selectedStyle = styleInputs.find((input) => input.checked)?.value ?? 'highlight';
  const rawSites = siteListInput?.value ?? '';
  const sites = rawSites
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  await chrome.storage.sync.set({
    sensitivity: value,
    highlightStyle: selectedStyle,
    [STORAGE_KEYS.siteList]: sites
  });

  statusElement.textContent = 'Options saved!';

  setTimeout(() => {
    statusElement.textContent = '';
  }, 1000);
}

async function restoreOptions() {
  if (!sensitivityInput || styleInputs.length === 0) {
    return;
  }

  const stored = await chrome.storage.sync.get(['sensitivity', 'highlightStyle', STORAGE_KEYS.siteList]);
  const sensitivity = stored?.sensitivity ?? 0.8;
  const highlightStyle = stored?.highlightStyle ?? 'highlight';
  const siteList = Array.isArray(stored?.[STORAGE_KEYS.siteList]) ? stored[STORAGE_KEYS.siteList] : [];

  sensitivityInput.value = sensitivity;
  styleInputs.forEach((input) => {
    input.checked = input.value === highlightStyle;
  });
  if (siteListInput) {
    siteListInput.value = siteList.join('\n');
  }
}

document.addEventListener('DOMContentLoaded', restoreOptions);

if (saveButton) {
  saveButton.addEventListener('click', saveOptions);
}
