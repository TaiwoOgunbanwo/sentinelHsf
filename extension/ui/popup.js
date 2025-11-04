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
  const apiStatusIndicator = document.getElementById('apiStatusIndicator');
  const apiStatusText = document.getElementById('apiStatusText');
  const highlightInputs = Array.from(document.querySelectorAll('input[name="popupHighlightStyle"]'));
  const historyList = document.getElementById('feedbackHistoryList');
  const pendingCountBadge = document.getElementById('pendingCount');
  const autoScanToggle = document.getElementById('autoScanToggle');
  const highlightLabels = {
    highlight: 'Highlight',
    blur: 'Blur',
    redact: 'Redact'
  };

  let statusClearHandle;
  let persistentStatus = 'Status: Ready to scan';
  const updateScanButtonState = (autoScanEnabled) => {
    if (!scanButton) {
      return;
    }
    if (autoScanEnabled) {
      scanButton.disabled = true;
      scanButton.textContent = 'Auto-scan is Active';
      scanButton.classList.add('button--disabled');
    } else {
      scanButton.disabled = false;
      scanButton.textContent = 'Scan This Page';
      scanButton.classList.remove('button--disabled');
    }
  };

  const setStatus = (text, { clearAfter = null } = {}) => {
    if (!pageStatus) {
      return;
    }
    const displayText =
      text && text.trim().toLowerCase().startsWith('status:')
        ? text
        : text
        ? `Status: ${text}`
        : '';
    pageStatus.textContent = displayText;
    if (clearAfter == null && displayText) {
      persistentStatus = displayText;
    } else if (clearAfter == null && !displayText) {
      pageStatus.textContent = persistentStatus;
    }
    if (statusClearHandle) {
      clearTimeout(statusClearHandle);
      statusClearHandle = null;
    }
    if (clearAfter != null) {
      statusClearHandle = setTimeout(() => {
        if (pageStatus.textContent === displayText) {
          pageStatus.textContent = persistentStatus;
        }
      }, clearAfter);
    }
  };

  const setAPIStatus = (state, label) => {
    if (!apiStatusIndicator || !apiStatusText) {
      return;
    }
    apiStatusIndicator.classList.remove('status-bar__dot--ok', 'status-bar__dot--working', 'status-bar__dot--error');
    if (state === 'ok') {
      apiStatusIndicator.classList.add('status-bar__dot--ok');
    } else if (state === 'working') {
      apiStatusIndicator.classList.add('status-bar__dot--working');
    } else if (state === 'error') {
      apiStatusIndicator.classList.add('status-bar__dot--error');
    }
    if (label) {
      apiStatusText.textContent = label;
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

  const hasHostPermission = () =>
    new Promise((resolve) => {
      if (!chrome.permissions?.contains) {
        resolve(false);
        return;
      }
      chrome.permissions.contains(
        { origins: ['https://*/*', 'http://*/*'] },
        (result) => {
          if (chrome.runtime?.lastError) {
            console.warn('Permission check failed:', chrome.runtime.lastError);
            resolve(false);
            return;
          }
          resolve(Boolean(result));
        }
      );
    });

  const requestHostPermission = () =>
    new Promise((resolve) => {
      if (!chrome.permissions?.request) {
        resolve(false);
        return;
      }
      chrome.permissions.request(
        { origins: ['https://*/*', 'http://*/*'] },
        (granted) => {
          if (chrome.runtime?.lastError) {
            console.warn('Permission request failed:', chrome.runtime.lastError);
            resolve(false);
            return;
          }
          resolve(Boolean(granted));
        }
      );
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
      updateScanButtonState(Boolean(autoScanEnabled));
      return Boolean(autoScanEnabled);
    } catch (error) {
      console.warn('Unable to load settings from storage.', error);
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

  if (autoScanToggle) {
    autoScanToggle.addEventListener('change', async (event) => {
      const enabled = event.target.checked;

      if (enabled) {
        const alreadyGranted = await hasHostPermission();
        let granted = alreadyGranted;
        if (!alreadyGranted) {
          granted = await requestHostPermission();
        }
        if (!granted) {
          event.target.checked = false;
          setStatus('Auto scan requires host access.', { clearAfter: 2500 });
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

      updateScanButtonState(enabled);
      setStatus(enabled ? 'Auto scan enabled.' : 'Auto scan disabled.', { clearAfter: 2000 });
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

  const summarizeScan = (scanInfo) => {
    if (!scanInfo || typeof scanInfo !== 'object') {
      return null;
    }

    const when = formatRelativeTime(scanInfo.timestamp);

    if (scanInfo.stopped) {
      return `Scanning paused${when ? ` (${when})` : ''}.`;
    }
    if (scanInfo.error) {
      const message = scanInfo.message || 'Scan failed.';
      return `Scan error: ${message}${when ? ` (${when})` : ''}`;
    }

    const flaggedElements =
      typeof scanInfo.flaggedElements === 'number' && Number.isFinite(scanInfo.flaggedElements)
        ? scanInfo.flaggedElements
        : null;
    const flaggedSegments =
      typeof scanInfo.flaggedSegments === 'number' && Number.isFinite(scanInfo.flaggedSegments)
        ? scanInfo.flaggedSegments
        : null;

    let summary;
    const count = flaggedElements ?? flaggedSegments;
    if (typeof count === 'number') {
      summary =
        count > 0
          ? `Scan complete – ${count} item${count === 1 ? '' : 's'} flagged.`
          : 'Scan complete – no hate speech found.';
    } else {
      summary = 'Scan complete.';
    }

    if (when) {
      summary += ` (${when})`;
    }

    return summary;
  };

  const updateStatusFromTelemetry = (telemetry = {}) => {
    if (!telemetry || typeof telemetry !== 'object') {
      setStatus('Ready to scan');
      setAPIStatus('idle', 'Ready');
      updateScanButtonState(false);
      return;
    }

    if (telemetry.lastInjectionError) {
      const message = telemetry.lastInjectionError.message || 'Auto-scan injection failed.';
      const when = formatRelativeTime(telemetry.lastInjectionError.timestamp);
      setStatus(`Auto-scan issue: ${message}${when ? ` (${when})` : ''}`);
      setAPIStatus('error', 'Auto-scan issue');
      updateScanButtonState(Boolean(telemetry.autoScanEnabled));
      return;
    }

    const scanSummary = summarizeScan(telemetry.lastScan);
    if (scanSummary) {
      setStatus(scanSummary);
      if (telemetry.lastScan?.error) {
        setAPIStatus('error', 'Scan error');
      } else {
        const flaggedCount =
          telemetry.lastScan?.flaggedElements ??
          telemetry.lastScan?.flaggedSegments ??
          0;
        const numericFlagged =
          typeof flaggedCount === 'number' && Number.isFinite(flaggedCount) ? flaggedCount : 0;
        setAPIStatus('ok', numericFlagged > 0 ? 'Flagged content' : 'Ready');
      }
      updateScanButtonState(Boolean(telemetry.autoScanEnabled));
      return;
    }

    if (telemetry.autoScanEnabled) {
      setStatus('Auto-scan enabled. Monitoring for new posts.');
      setAPIStatus('idle', 'Monitoring');
      updateScanButtonState(true);
      return;
    }

    setStatus('Ready to scan');
    setAPIStatus('idle', 'Ready');
    updateScanButtonState(false);
  };

  const requestTelemetry = () => {
    try {
      chrome.runtime.sendMessage({ source: 'deb-popup', type: 'telemetry-request' }, (response) => {
        if (chrome.runtime?.lastError) {
          return;
        }
        if (response?.ok && response.telemetry) {
          updateStatusFromTelemetry(response.telemetry);
        }
      });
    } catch (error) {
      console.warn('Telemetry request failed:', error);
    }
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
      if (scanButton.disabled) {
        return;
      }
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
      if (!message) {
        return;
      }

      if (message.source === 'deb-background') {
        const detail = message.detail ?? {};
        switch (message.type) {
          case 'background-fetch-offline':
            if (detail.context === 'scan') {
              setStatus('Unable to reach the backend (offline?).', { clearAfter: 4000 });
              setAPIStatus('error', 'Offline');
            }
            break;
          case 'background-fetch-failed': {
            const summary = Array.isArray(detail.attempts)
              ? detail.attempts
                  .map((info) => `${info.base || 'api'}: ${info.message ?? 'failed'}`)
                  .join('; ')
              : detail.message;
            if (detail.context === 'scan') {
              setStatus(`Scan request failed after retries. ${summary || ''}`.trim(), { clearAfter: 5000 });
              setAPIStatus('error', 'Scan failed');
            } else if (detail.context === 'feedback') {
              setStatus('Feedback submission failed; will retry automatically.', { clearAfter: 4000 });
            }
            break;
          }
          case 'auto-scan-injection-failed':
            setStatus('Auto-scan could not inject on this page. Use manual scan.', { clearAfter: 4000 });
            setAPIStatus('error', 'Auto-scan error');
            break;
          case 'telemetry-update':
            if (detail.telemetry) {
              updateStatusFromTelemetry(detail.telemetry);
            }
            break;
          default:
            break;
        }
        return;
      }

      if (message.source !== 'deb-scanner') {
        return;
      }

      switch (message.type) {
        case 'scan-start':
          setStatus('Scanning page…');
          setAPIStatus('working', 'Scanning…');
          break;
        case 'scan-progress': {
          const active = message.detail?.active ?? 0;
          const batchSize = message.detail?.batchSize;
          const batchInfo = batchSize ? ` batch size ${batchSize}` : '';
          setStatus(active > 0 ? `Analyzing posts (${active} active${batchInfo})` : 'Finalizing…');
          break;
        }
        case 'scan-complete': {
          const flagged =
            message.detail?.flaggedElements ??
            message.detail?.flaggedSegments ??
            (message.detail?.summary?.flaggedElements ?? message.detail?.summary?.flaggedSegments ?? 0);
          const safeCount = Number.isFinite(flagged) ? Number(flagged) : 0;
          if (safeCount > 0) {
            const label = safeCount === 1 ? 'item' : 'items';
            setStatus(`Scan complete – ${safeCount} ${label} flagged.`);
            setAPIStatus('ok', 'Flagged content');
          } else {
            setStatus('Scan complete – no hate speech found.');
            setAPIStatus('ok', 'Scan complete');
          }
          break;
        }
        case 'scan-error':
          setStatus(`Scan failed: ${message.detail?.message ?? 'See console.'}`);
          setAPIStatus('error', 'Scan failed');
          break;
        case 'scan-stopped':
          setStatus('Scanning paused on this page.', { clearAfter: 2000 });
          setAPIStatus('idle', 'Paused');
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
      setAPIStatus('working', 'Analyzing…');

      let lastError;

      for (const endpoint of API_ENDPOINTS) {
        try {
          const headers = {
            'Content-Type': 'application/json'
          };
          const response = await fetch(endpoint, {
            method: 'POST',
            headers,
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
          setAPIStatus('ok', 'Analysis OK');
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
      setAPIStatus('error', 'Analysis failed');
    });
  }

  loadSettings()
    .then((autoEnabled) => {
      if (autoEnabled) {
        setStatus('Auto-scan enabled. Monitoring for new posts.');
        setAPIStatus('idle', 'Monitoring');
      } else {
        setStatus('Ready to scan');
        setAPIStatus('idle', 'Ready');
      }
    })
    .catch(() => {
      setStatus('Ready to scan');
      setAPIStatus('idle', 'Ready');
    })
    .finally(() => {
      requestTelemetry();
    });

  loadFeedbackMeta();
});
