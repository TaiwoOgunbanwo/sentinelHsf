import { CONFIG } from '../config.js';

document.addEventListener('DOMContentLoaded', () => {
  const API_ENDPOINTS = CONFIG.API_BASES.map((base) => `${base}/predict`);
  const STORAGE_KEYS = CONFIG.STORAGE_KEYS;
  const scanButton = document.getElementById('scanButton');
  const analyzeButton = document.getElementById('analyzeButton');
  const analysisInput = document.getElementById('analysisInput');
  const analysisResult = document.getElementById('analysisResult');
  const sensitivitySlider = document.getElementById('popupSensitivity');
  const sensitivityValue = document.getElementById('sensitivityValue');
  const pageStatus = document.getElementById('pageStatus');
  const highlightInputs = Array.from(document.querySelectorAll('input[name="popupHighlightStyle"]'));
  const historyList = document.getElementById('feedbackHistoryList');
  const pendingCountBadge = document.getElementById('pendingCount');
  const highlightLabels = {
    highlight: 'Highlight',
    blur: 'Blur',
    redact: 'Redact'
  };

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

  const applyHighlightSelection = (value) => {
    highlightInputs.forEach((input) => {
      input.checked = input.value === value;
    });
  };

  const loadSettings = async () => {
    try {
      const { sensitivity = 0.8, highlightStyle = 'highlight' } = await chrome.storage.sync.get([
        'sensitivity',
        'highlightStyle'
      ]);
      if (sensitivitySlider) {
        sensitivitySlider.value = sensitivity;
        updateSensitivityValue(sensitivity);
      }
      applyHighlightSelection(highlightStyle);
    } catch (error) {
      console.warn('Unable to load settings from storage.', error);
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
      setStatus(`Highlight style set to ${label}`, { clearAfter: 1500 });
    } catch (error) {
      console.warn('Unable to save highlight style.', error);
      setStatus('Failed to save highlight style.', { clearAfter: 2000 });
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

  const renderPendingCount = (count) => {
    if (!pendingCountBadge) {
      return;
    }
    if (count > 0) {
      pendingCountBadge.textContent = `${count} pending`;
      pendingCountBadge.dataset.status = 'pending';
    } else {
      pendingCountBadge.textContent = 'No pending';
      pendingCountBadge.dataset.status = 'clear';
    }
  };

  const formatRelativeTime = (timestamp) => {
    if (!timestamp) {
      return '';
    }
    const diff = Date.now() - timestamp;
    if (Number.isNaN(diff)) {
      return '';
    }
    if (diff < 60_000) {
      return 'just now';
    }
    if (diff < 3_600_000) {
      const minutes = Math.round(diff / 60_000);
      return `${minutes}m ago`;
    }
    if (diff < 86_400_000) {
      const hours = Math.round(diff / 3_600_000);
      return `${hours}h ago`;
    }
    const days = Math.round(diff / 86_400_000);
    return `${days}d ago`;
  };

  const createHistoryItem = (entry) => {
    const li = document.createElement('li');
    li.className = `feedback-item feedback-item--${entry.status || 'sent'}`;

    const pill = document.createElement('span');
    pill.className = 'feedback-pill';
    const pillLabel =
      entry.status === 'queued'
        ? 'Queued'
        : entry.reportType === 'not_hate'
        ? 'Not hate?'
        : 'Flagged';
    pill.textContent = pillLabel;

    const summary = document.createElement('span');
    summary.className = 'feedback-summary';
    const snippet = entry.snippet ? entry.snippet.slice(0, 80) : '';
    const snippetText = snippet ? `“${snippet}${entry.snippet && entry.snippet.length > 80 ? '…' : ''}”` : '';
    const scoreText =
      typeof entry.score === 'number' && Number.isFinite(entry.score)
        ? ` • ${entry.score.toFixed(2)}`
        : '';
    summary.textContent = `${pillLabel}${scoreText}${snippetText ? ` • ${snippetText}` : ''}`;

    const meta = document.createElement('span');
    meta.className = 'feedback-meta';
    const time = entry.sentAt ?? entry.queuedAt ?? entry.createdAt;
    meta.textContent = formatRelativeTime(time);

    li.appendChild(pill);
    li.appendChild(summary);
    if (meta.textContent) {
      li.appendChild(meta);
    }
    return li;
  };

  const renderHistory = (history) => {
    if (!historyList) {
      return;
    }
    historyList.innerHTML = '';
    if (!Array.isArray(history) || history.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'feedback-item feedback-item--empty';
      empty.textContent = 'No feedback yet.';
      historyList.appendChild(empty);
      return;
    }
    history.slice(0, 8).forEach((entry) => {
      historyList.appendChild(createHistoryItem(entry));
    });
  };

  const readLocal = (keys) =>
    new Promise((resolve) => {
      if (!chrome.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime?.lastError) {
          console.warn('Unable to read local storage:', chrome.runtime.lastError);
          resolve({});
          return;
        }
        resolve(result);
      });
    });

  const loadFeedbackMeta = async () => {
    try {
      const data = await readLocal([STORAGE_KEYS.pendingReports, STORAGE_KEYS.feedbackHistory]);
      const pending = Array.isArray(data?.[STORAGE_KEYS.pendingReports])
        ? data[STORAGE_KEYS.pendingReports].length
        : 0;
      const history = Array.isArray(data?.[STORAGE_KEYS.feedbackHistory])
        ? data[STORAGE_KEYS.feedbackHistory]
        : [];
      renderPendingCount(pending);
      renderHistory(history);
    } catch (error) {
      console.warn('Failed to load feedback metadata.', error);
    }
  };

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
        case 'feedback-history-updated':
          loadFeedbackMeta();
          break;
        case 'feedback-pending':
          renderPendingCount(message.detail?.count ?? 0);
          break;
        case 'feedback-queued':
          setStatus('Feedback queued for retry.', { clearAfter: 2000 });
          loadFeedbackMeta();
          break;
        case 'feedback-sent':
          setStatus('Feedback submitted.', { clearAfter: 1500 });
          loadFeedbackMeta();
          break;
        case 'feedback-error':
          setStatus('Feedback failed. Try again later.', { clearAfter: 2500 });
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
              'Content-Type': 'application/json',
              'X-API-Key': CONFIG.API_KEY
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
  loadFeedbackMeta();
});
