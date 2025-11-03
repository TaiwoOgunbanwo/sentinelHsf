document.addEventListener('DOMContentLoaded', () => {
  const API_ENDPOINTS = ['https://localhost:5000/predict', 'http://localhost:5000/predict'];
  const scanButton = document.getElementById('scanButton');
  const analyzeButton = document.getElementById('analyzeButton');
  const analysisInput = document.getElementById('analysisInput');
  const analysisResult = document.getElementById('analysisResult');
  const sensitivitySlider = document.getElementById('popupSensitivity');
  const sensitivityValue = document.getElementById('sensitivityValue');
  const pageStatus = document.getElementById('pageStatus');

  let statusClearHandle;
  const setStatus = (text, { clearAfter = null } = {}) => {
    if (!pageStatus) {
      return;
    }
    pageStatus.textContent = text || '';
    if (statusClearHandle) {
      clearTimeout(statusClearHandle);
      statusClearHandle = null;
    }
    if (clearAfter != null) {
      statusClearHandle = setTimeout(() => {
        if (pageStatus.textContent === text) {
          pageStatus.textContent = '';
        }
      }, clearAfter);
    }
  };

  const updateSensitivityValue = (value) => {
    if (sensitivityValue) {
      sensitivityValue.textContent = `Confidence: ${parseFloat(value).toFixed(2)}`;
    }
  };

  const loadSettings = async () => {
    try {
      const { sensitivity = 0.8 } = await chrome.storage.sync.get('sensitivity');
      if (sensitivitySlider) {
        sensitivitySlider.value = sensitivity;
        updateSensitivityValue(sensitivity);
      }
    } catch (error) {
      console.warn('Unable to load sensitivity from storage.', error);
    }
  };

  const saveSensitivity = async (value) => {
    try {
      await chrome.storage.sync.set({ sensitivity: parseFloat(value) });
    } catch (error) {
      console.warn('Unable to save sensitivity.', error);
    }
  };

  if (sensitivitySlider) {
    sensitivitySlider.addEventListener('input', (event) => {
      updateSensitivityValue(event.target.value);
    });

    sensitivitySlider.addEventListener('change', async (event) => {
      const { value } = event.target;
      await saveSensitivity(value);
      setStatus(`Sensitivity set to ${parseFloat(value).toFixed(2)}`, { clearAfter: 1500 });
    });
  }

  if (scanButton) {
    scanButton.addEventListener('click', async () => {
      setStatus('Starting scan…');
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab?.id) {
          console.error('No active tab found.');
          setStatus('No active tab found.');
          return;
        }

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['extension/content/content.js']
        });

        setStatus('Scan triggered.', { clearAfter: 2000 });
      } catch (error) {
        console.error('Failed to execute content script:', error);
        setStatus('Scan failed. Check console.');
      }
    });
  }

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || message.source !== 'deb-scanner') {
        return;
      }

      switch (message.type) {
        case 'scan-start':
          setStatus('Scanning page…');
          break;
        case 'scan-progress': {
          const active = message.detail?.active ?? 0;
          const batchSize = message.detail?.batchSize;
          const batchInfo = batchSize ? ` batch size ${batchSize}` : '';
          setStatus(active > 0 ? `Analyzing posts (${active} active${batchInfo})` : 'Finalizing…');
          break;
        }
        case 'scan-complete':
          setStatus('Scan complete.', { clearAfter: 2000 });
          break;
        case 'scan-error':
          setStatus(`Scan failed: ${message.detail?.message ?? 'See console.'}`);
          break;
        default:
          break;
      }
    });
  }

  if (analyzeButton && analysisInput && analysisResult) {
    analyzeButton.addEventListener('click', async () => {
      const text = analysisInput.value.trim();

      if (!text) {
        analysisResult.textContent = 'Enter text to analyze.';
        return;
      }

      analysisResult.textContent = 'Analyzing...';

      let lastError;

      for (const endpoint of API_ENDPOINTS) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const result = await response.json();
          const score = typeof result.score === 'number' ? result.score.toFixed(4) : 'n/a';
          analysisResult.textContent = result?.label
            ? `${result.label} (${score})`
            : 'No label returned.';
          return;
        } catch (error) {
          lastError = error;
          console.warn('Manual analysis endpoint failed:', endpoint, error);
        }
      }

      console.error('Manual analysis failed:', lastError);
      analysisResult.textContent =
        lastError && lastError.message && lastError.message.includes('ERR_CERT')
          ? 'Certificate not trusted. Open https://localhost:5000 once to proceed.'
          : 'Analysis failed. Check console.';
    });
  }

  loadSettings();
});
