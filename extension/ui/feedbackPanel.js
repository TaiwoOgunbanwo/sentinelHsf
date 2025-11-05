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

const createFeedbackPanel = ({ listEl, badgeEl, storageKeys }) => {
  const historyList = listEl ?? null;
  const badge = badgeEl ?? null;

  const renderPendingCount = (count) => {
    if (!badge) {
      return;
    }
    if (count > 0) {
      badge.textContent = `${count} pending`;
      badge.dataset.status = 'pending';
    } else {
      badge.textContent = 'No pending';
      badge.dataset.status = 'clear';
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
      const data = await readLocal([storageKeys.pendingReports, storageKeys.feedbackHistory]);
      const pending = Array.isArray(data?.[storageKeys.pendingReports])
        ? data[storageKeys.pendingReports].length
        : 0;
      const history = Array.isArray(data?.[storageKeys.feedbackHistory]) ? data[storageKeys.feedbackHistory] : [];
      renderPendingCount(pending);
      renderHistory(history);
    } catch (error) {
      console.warn('Failed to load feedback metadata.', error);
    }
  };

  return {
    renderPendingCount,
    renderHistory,
    loadFeedbackMeta
  };
};

export { createFeedbackPanel, formatRelativeTime };
