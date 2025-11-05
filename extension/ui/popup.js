import { CONFIG } from '../config.js';
import { createStatusController } from './status.js';
import { createSettingsController } from './settings.js';
import { createFeedbackPanel } from './feedbackPanel.js';
import { createTelemetryController } from './telemetry.js';
import { createAnalyzer } from './analyzer.js';

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

  const status = createStatusController({
    pageStatus,
    apiStatusIndicator,
    apiStatusText,
    scanButton
  });

  const settings = createSettingsController({
    status,
    highlightInputs,
    sensitivitySlider,
    sensitivityValue,
    autoScanToggle
  });

  const feedbackPanel = createFeedbackPanel({
    listEl: historyList,
    badgeEl: pendingCountBadge,
    storageKeys: STORAGE_KEYS
  });

  const telemetry = createTelemetryController({ status });

  const analyzer = createAnalyzer({
    endpoints: API_ENDPOINTS,
    inputEl: analysisInput,
    resultEl: analysisResult,
    status
  });

  settings.attachEventHandlers();

  const analyzeHandler = analyzer.attach();
  if (analyzeButton && typeof analyzeHandler === 'function') {
    analyzeButton.addEventListener('click', analyzeHandler);
  }

  if (scanButton) {
    scanButton.addEventListener('click', async () => {
      if (scanButton.disabled) {
        return;
      }

      status.setStatus('Starting scan…');
      status.setAPIStatus('working', 'Scanning…');

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab?.id) {
          console.error('No active tab found.');
          status.setStatus('No active tab found.');
          status.setAPIStatus('error', 'No active tab');
          return;
        }

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['extension/content/content.js']
        });

        status.setStatus('Scan triggered.', { clearAfter: 2000 });
      } catch (error) {
        console.error('Failed to execute content script:', error);
        status.setStatus('Scan failed. Check console.');
        status.setAPIStatus('error', 'Scan failed');
      }
    });
  }

  const handleBackgroundMessage = (detail, type) => {
    switch (type) {
      case 'background-fetch-offline':
        if (detail?.context === 'scan') {
          status.setStatus('Unable to reach the backend (offline?).', { clearAfter: 4000 });
          status.setAPIStatus('error', 'Offline');
        }
        break;
      case 'background-fetch-failed': {
        const summary = Array.isArray(detail?.attempts)
          ? detail.attempts.map((info) => `${info.base || 'api'}: ${info.message ?? 'failed'}`).join('; ')
          : detail?.message;
        if (detail?.context === 'scan') {
          const message = `Scan request failed after retries.${summary ? ` ${summary}` : ''}`.trim();
          status.setStatus(message, { clearAfter: 5000 });
          status.setAPIStatus('error', 'Scan failed');
        } else if (detail?.context === 'feedback') {
          status.setStatus('Feedback submission failed; will retry automatically.', { clearAfter: 4000 });
        }
        break;
      }
      case 'auto-scan-injection-failed':
        status.setStatus('Auto-scan could not inject on this page. Use manual scan.', { clearAfter: 4000 });
        status.setAPIStatus('error', 'Auto-scan error');
        break;
      case 'telemetry-update':
        if (detail?.telemetry) {
          telemetry.updateFromTelemetry(detail.telemetry);
        }
        break;
      default:
        break;
    }
  };

  const handleScannerMessage = (message) => {
    switch (message.type) {
      case 'scan-start':
        status.setStatus('Scanning page…');
        status.setAPIStatus('working', 'Scanning…');
        break;
      case 'scan-progress': {
        const active = message.detail?.active ?? 0;
        const batchSize = message.detail?.batchSize;
        const batchInfo = batchSize ? ` batch size ${batchSize}` : '';
        status.setStatus(active > 0 ? `Analyzing posts (${active} active${batchInfo})` : 'Finalizing…');
        break;
      }
      case 'scan-complete': {
        const summary = telemetry.summarizeCompletion(message.detail);
        status.setStatus(summary.message, { clearAfter: 2000 });
        status.setAPIStatus(summary.apiState.state, summary.apiState.label);
        break;
      }
      case 'scan-error':
        status.setStatus(`Scan failed: ${message.detail?.message ?? 'See console.'}`);
        status.setAPIStatus('error', 'Scan failed');
        break;
      case 'scan-stopped':
        status.setStatus('Scanning paused on this page.', { clearAfter: 2000 });
        status.setAPIStatus('idle', 'Paused');
        break;
      case 'feedback-history-updated':
        feedbackPanel.loadFeedbackMeta();
        break;
      case 'feedback-pending':
        feedbackPanel.renderPendingCount(message.detail?.count ?? 0);
        break;
      case 'feedback-queued':
        status.setStatus('Feedback queued for retry.', { clearAfter: 2000 });
        feedbackPanel.loadFeedbackMeta();
        break;
      case 'feedback-sent':
        status.setStatus('Feedback submitted.', { clearAfter: 1500 });
        feedbackPanel.loadFeedbackMeta();
        break;
      case 'feedback-error':
        status.setStatus('Feedback failed. Try again later.', { clearAfter: 2500 });
        break;
      default:
        break;
    }
  };

  const messageListener = (message) => {
    if (!message) {
      return;
    }

    if (message.source === 'deb-background') {
      handleBackgroundMessage(message.detail ?? {}, message.type);
      return;
    }

    if (message.source === 'deb-scanner') {
      handleScannerMessage(message);
    }
  };

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(messageListener);
  }

  settings
    .loadSettings()
    .then((autoEnabled) => {
      if (autoEnabled) {
        status.setStatus('Auto-scan enabled. Monitoring for new posts.');
        status.setAPIStatus('idle', 'Monitoring');
      } else {
        status.setStatus('Ready to scan');
        status.setAPIStatus('idle', 'Ready');
      }
    })
    .catch(() => {
      status.setStatus('Ready to scan');
      status.setAPIStatus('idle', 'Ready');
    })
    .finally(() => {
      telemetry.requestTelemetry();
    });

  feedbackPanel.loadFeedbackMeta();
});
