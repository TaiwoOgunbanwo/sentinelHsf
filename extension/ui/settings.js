const createSettingsController = ({
  status,
  highlightInputs = [],
  sensitivitySlider,
  sensitivityValue,
  autoScanToggle,
  highlightLabels = {
    highlight: 'Highlight',
    blur: 'Blur',
    redact: 'Redact'
  }
}) => {
  const updateSensitivityValue = (value) => {
    if (sensitivityValue) {
      sensitivityValue.textContent = `Confidence: ${parseFloat(value).toFixed(2)}`;
    }
  };

  const applyHighlightSelection = (value) => {
    highlightInputs.forEach((input) => {
      input.checked = input.value === value;
    });
  };

  const hasHostPermission = () =>
    new Promise((resolve) => {
      if (!chrome.permissions?.contains) {
        resolve(false);
        return;
      }
      chrome.permissions.contains({ origins: ['https://*/*', 'http://*/*'] }, (result) => {
        if (chrome.runtime?.lastError) {
          console.warn('Permission check failed:', chrome.runtime.lastError);
          resolve(false);
          return;
        }
        resolve(Boolean(result));
      });
    });

  const requestHostPermission = () =>
    new Promise((resolve) => {
      if (!chrome.permissions?.request) {
        resolve(false);
        return;
      }
      chrome.permissions.request({ origins: ['https://*/*', 'http://*/*'] }, (granted) => {
        if (chrome.runtime?.lastError) {
          console.warn('Permission request failed:', chrome.runtime.lastError);
          resolve(false);
          return;
        }
        resolve(Boolean(granted));
      });
    });

  const loadSettings = async () => {
    try {
      const { sensitivity = 0.8, highlightStyle = 'highlight', autoScanEnabled = false } =
        await chrome.storage.sync.get(['sensitivity', 'highlightStyle', 'autoScanEnabled']);

      if (sensitivitySlider) {
        sensitivitySlider.value = sensitivity;
        updateSensitivityValue(sensitivity);
      }
      applyHighlightSelection(highlightStyle);
      if (autoScanToggle) {
        autoScanToggle.checked = Boolean(autoScanEnabled);
      }
      status.updateScanButtonState(Boolean(autoScanEnabled));
      return Boolean(autoScanEnabled);
    } catch (error) {
      console.warn('Unable to load settings from storage.', error);
      status.updateScanButtonState(false);
      return false;
    }
  };

  const saveSensitivity = async (value) => {
    try {
      await chrome.storage.sync.set({ sensitivity: parseFloat(value) });
    } catch (error) {
      console.warn('Unable to save sensitivity.', error);
    }
  };

  const saveHighlightStyle = async (value) => {
    try {
      await chrome.storage.sync.set({ highlightStyle: value });
      const label = highlightLabels[value] ?? value;
      status.setStatus(`Highlight style set to ${label}`, { clearAfter: 1500 });
    } catch (error) {
      console.warn('Unable to save highlight style.', error);
      status.setStatus('Failed to save highlight style.', { clearAfter: 2000 });
    }
  };

  const handleAutoScanToggle = async (event) => {
    const enabled = event.target.checked;

    if (enabled) {
      const alreadyGranted = await hasHostPermission();
      let granted = alreadyGranted;
      if (!alreadyGranted) {
        granted = await requestHostPermission();
      }
      if (!granted) {
        event.target.checked = false;
        status.updateScanButtonState(false);
        status.setStatus('Auto scan requires host access.', { clearAfter: 2500 });
        return;
      }
    }

    chrome.runtime.sendMessage({
      source: 'deb-popup',
      type: 'auto-scan-updated',
      enabled,
      injectCurrentTab: enabled
    });

    try {
      await chrome.storage.sync.set({ autoScanEnabled: enabled });
    } catch (error) {
      console.warn('Unable to persist auto-scan toggle.', error);
    }

    status.updateScanButtonState(enabled);
    status.setStatus(enabled ? 'Auto scan enabled.' : 'Auto scan disabled.', { clearAfter: 2000 });
  };

  const attachEventHandlers = () => {
    if (sensitivitySlider) {
      sensitivitySlider.addEventListener('input', (event) => {
        updateSensitivityValue(event.target.value);
      });

      sensitivitySlider.addEventListener('change', async (event) => {
        const { value } = event.target;
        await saveSensitivity(value);
        status.setStatus(`Sensitivity set to ${parseFloat(value).toFixed(2)}`, { clearAfter: 1500 });
      });
    }

    if (highlightInputs.length) {
      highlightInputs.forEach((input) => {
        input.addEventListener('change', async (event) => {
          if (!event.target.checked) {
            return;
          }
          await saveHighlightStyle(event.target.value);
        });
      });
    }

    if (autoScanToggle) {
      autoScanToggle.addEventListener('change', handleAutoScanToggle);
    }
  };

  return {
    loadSettings,
    attachEventHandlers,
    applyHighlightSelection,
    updateSensitivityValue
  };
};

export { createSettingsController };
