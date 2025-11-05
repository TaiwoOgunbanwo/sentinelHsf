import { formatRelativeTime } from './feedbackPanel.js';

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

const createTelemetryController = ({ status }) => {
  const updateFromTelemetry = (telemetry = {}) => {
    if (!telemetry || typeof telemetry !== 'object') {
      status.setStatus('Ready to scan');
      status.setAPIStatus('idle', 'Ready');
      status.updateScanButtonState(false);
      return;
    }

    if (telemetry.lastInjectionError) {
      const message = telemetry.lastInjectionError.message || 'Auto-scan injection failed.';
      const when = formatRelativeTime(telemetry.lastInjectionError.timestamp);
      status.setStatus(`Auto-scan issue: ${message}${when ? ` (${when})` : ''}`);
      status.setAPIStatus('error', 'Auto-scan issue');
      status.updateScanButtonState(Boolean(telemetry.autoScanEnabled));
      return;
    }

    const scanSummary = summarizeScan(telemetry.lastScan);
    if (scanSummary) {
      status.setStatus(scanSummary);
      if (telemetry.lastScan?.error) {
        status.setAPIStatus('error', 'Scan error');
      } else {
        const flaggedCount =
          telemetry.lastScan?.flaggedElements ??
          telemetry.lastScan?.flaggedSegments ??
          0;
        const numericFlagged =
          typeof flaggedCount === 'number' && Number.isFinite(flaggedCount) ? flaggedCount : 0;
        status.setAPIStatus('ok', numericFlagged > 0 ? 'Flagged content' : 'Ready');
      }
      status.updateScanButtonState(Boolean(telemetry.autoScanEnabled));
      return;
    }

    if (telemetry.autoScanEnabled) {
      status.setStatus('Auto-scan enabled. Monitoring for new posts.');
      status.setAPIStatus('idle', 'Monitoring');
      status.updateScanButtonState(true);
      return;
    }

    status.setStatus('Ready to scan');
    status.setAPIStatus('idle', 'Ready');
    status.updateScanButtonState(false);
  };

  const requestTelemetry = () => {
    try {
      chrome.runtime.sendMessage({ source: 'deb-popup', type: 'telemetry-request' }, (response) => {
        if (chrome.runtime?.lastError) {
          return;
        }
        if (response?.ok && response.telemetry) {
          updateFromTelemetry(response.telemetry);
        }
      });
    } catch (error) {
      console.warn('Telemetry request failed:', error);
    }
  };

  const summarizeCompletion = (detail = {}) => {
    const flagged =
      detail.flaggedElements ??
      detail.flaggedSegments ??
      detail.summary?.flaggedElements ??
      detail.summary?.flaggedSegments ??
      0;
    const numericFlagged = typeof flagged === 'number' && Number.isFinite(flagged) ? flagged : 0;
    if (numericFlagged > 0) {
      const label = numericFlagged === 1 ? 'item' : 'items';
      return {
        message: `Scan complete – ${numericFlagged} ${label} flagged.`,
        apiState: { state: 'ok', label: 'Flagged content' }
      };
    }
    return {
      message: 'Scan complete – no hate speech found.',
      apiState: { state: 'ok', label: 'Scan complete' }
    };
  };

  return {
    updateFromTelemetry,
    requestTelemetry,
    summarizeCompletion
  };
};

export { createTelemetryController, summarizeScan };
