const ensureElement = (el) => el ?? null;

const createStatusController = ({ pageStatus, apiStatusIndicator, apiStatusText, scanButton }) => {
  const statusEl = ensureElement(pageStatus);
  const indicatorEl = ensureElement(apiStatusIndicator);
  const apiTextEl = ensureElement(apiStatusText);
  const scanButtonEl = ensureElement(scanButton);

  let statusClearHandle = null;
  let persistentStatus = 'Status: Ready to scan';

  const formatStatus = (text) => {
    if (!text) {
      return '';
    }
    const trimmed = String(text).trim();
    if (!trimmed) {
      return '';
    }
    return trimmed.toLowerCase().startsWith('status:') ? trimmed : `Status: ${trimmed}`;
  };

  const applyPersistentStatus = () => {
    if (statusEl) {
      statusEl.textContent = persistentStatus;
    }
  };

  const setStatus = (text, { clearAfter = null } = {}) => {
    if (!statusEl) {
      return;
    }

    if (statusClearHandle) {
      clearTimeout(statusClearHandle);
      statusClearHandle = null;
    }

    const displayText = formatStatus(text);

    if (clearAfter == null) {
      if (displayText) {
        persistentStatus = displayText;
        statusEl.textContent = displayText;
      } else {
        applyPersistentStatus();
      }
      return;
    }

    statusEl.textContent = displayText || persistentStatus;
    statusClearHandle = setTimeout(() => {
      statusClearHandle = null;
      applyPersistentStatus();
    }, clearAfter);
  };

  const setAPIStatus = (state, label) => {
    if (!indicatorEl || !apiTextEl) {
      return;
    }
    indicatorEl.classList.remove('status-bar__dot--ok', 'status-bar__dot--working', 'status-bar__dot--error');
    if (state === 'ok') {
      indicatorEl.classList.add('status-bar__dot--ok');
    } else if (state === 'working') {
      indicatorEl.classList.add('status-bar__dot--working');
    } else if (state === 'error') {
      indicatorEl.classList.add('status-bar__dot--error');
    }
    if (label) {
      apiTextEl.textContent = label;
    }
  };

  const updateScanButtonState = (enabled) => {
    if (!scanButtonEl) {
      return;
    }
    if (enabled) {
      scanButtonEl.disabled = true;
      scanButtonEl.textContent = 'Auto-scan is Active';
      scanButtonEl.classList.add('button--disabled');
    } else {
      scanButtonEl.disabled = false;
      scanButtonEl.textContent = 'Scan This Page';
      scanButtonEl.classList.remove('button--disabled');
    }
  };

  const setPersistentStatus = (text) => {
    const formatted = formatStatus(text);
    persistentStatus = formatted || persistentStatus;
    applyPersistentStatus();
  };

  return {
    setStatus,
    setAPIStatus,
    updateScanButtonState,
    setPersistentStatus,
    getPersistentStatus: () => persistentStatus
  };
};

export { createStatusController };
