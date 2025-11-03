export const createFeedbackManager = ({
  storage,
  notifyExtension,
  storageKeys,
  maxHistory,
  retryAttempts,
  retryDelays,
  delay,
  fetchWithFallback
}) => {
  const readLocalKey = async (key, fallback = []) => {
    if (!storage) {
      return fallback;
    }
    return new Promise((resolve) => {
      storage.get([key], (result) => {
        if (chrome.runtime?.lastError) {
          console.warn('[Sentinel] Storage read failed:', chrome.runtime.lastError);
          resolve(fallback);
          return;
        }
        resolve(result?.[key] ?? fallback);
      });
    });
  };

  const writeLocalKey = async (key, value) => {
    if (!storage) {
      return false;
    }
    return new Promise((resolve) => {
      storage.set({ [key]: value }, () => {
        if (chrome.runtime?.lastError) {
          console.warn('[Sentinel] Storage write failed:', chrome.runtime.lastError);
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  };

  const reportPendingCount = (count) => notifyExtension('feedback-pending', { count });

  const addFeedbackHistoryEntry = async (entry) => {
    if (!entry) {
      return;
    }
    const history = await readLocalKey(storageKeys.feedbackHistory, []);
    const list = Array.isArray(history) ? history : [];
    list.unshift(entry);
    if (list.length > maxHistory) {
      list.length = maxHistory;
    }
    await writeLocalKey(storageKeys.feedbackHistory, list);
    notifyExtension('feedback-history-updated', { entryId: entry.id ?? null });
  };

  const updateFeedbackHistoryEntry = async (id, updates) => {
    if (!id) {
      return;
    }
    const history = await readLocalKey(storageKeys.feedbackHistory, []);
    if (!Array.isArray(history) || history.length === 0) {
      return;
    }
    const list = [...history];
    const index = list.findIndex((item) => item?.id === id);
    if (index === -1) {
      list.unshift({ id, ...updates });
      if (list.length > maxHistory) {
        list.length = maxHistory;
      }
    } else {
      list[index] = { ...list[index], ...updates };
    }
    await writeLocalKey(storageKeys.feedbackHistory, list);
    notifyExtension('feedback-history-updated', { entryId: id });
  };

  let flushingFeedback = false;
  let pendingFlushTimer = null;

  const queueFeedbackReport = async (item) => {
    if (!item) {
      return false;
    }
    const existing = await readLocalKey(storageKeys.pendingReports, []);
    const queue = Array.isArray(existing) ? existing : [];
    queue.push(item);
    const success = await writeLocalKey(storageKeys.pendingReports, queue);
    if (success) {
      reportPendingCount(queue.length);
      schedulePendingFlush(5000);
    }
    return success;
  };

  const flushPendingFeedback = async () => {
    if (!storage) {
      return;
    }
    if (flushingFeedback) {
      return;
    }

    flushingFeedback = true;
    try {
      const pending = await readLocalKey(storageKeys.pendingReports, []);
      const queue = Array.isArray(pending) ? [...pending] : [];
      if (queue.length === 0) {
        reportPendingCount(0);
        return;
      }

      const remaining = [];

      for (const item of queue) {
        const baseHistory = item.history ?? null;
        try {
          await sendFeedbackPayload(item.payload);
          await updateFeedbackHistoryEntry(item.id, {
            ...(baseHistory || {}),
            status: 'sent',
            sentAt: Date.now(),
            lastError: null
          });
        } catch (error) {
          const retries = (item.retries ?? 0) + 1;
          const message = error?.message ?? 'Failed to send feedback.';
          remaining.push({
            ...item,
            retries,
            lastError: message
          });
          await updateFeedbackHistoryEntry(item.id, {
            ...(baseHistory || {}),
            status: 'queued',
            retries,
            lastError: message
          });
        }
      }

      await writeLocalKey(storageKeys.pendingReports, remaining);
      reportPendingCount(remaining.length);
      if (remaining.length > 0) {
        schedulePendingFlush(15000);
      }
    } finally {
      flushingFeedback = false;
    }
  };

  const schedulePendingFlush = (delayMs = 0) => {
    if (!storage) {
      return;
    }
    if (pendingFlushTimer) {
      return;
    }
    pendingFlushTimer = setTimeout(() => {
      pendingFlushTimer = null;
      void flushPendingFeedback();
    }, Math.max(0, delayMs));
  };

  const initializePendingFeedback = async () => {
    if (!storage) {
      return;
    }
    const pending = await readLocalKey(storageKeys.pendingReports, []);
    const count = Array.isArray(pending) ? pending.length : 0;
    reportPendingCount(count);
    if (count > 0) {
      schedulePendingFlush(0);
    }
  };

  const sendFeedbackPayload = async (payload) => {
    let lastError;
    for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
      if (attempt > 0) {
        const delayMs = retryDelays[attempt] ?? retryDelays[retryDelays.length - 1];
        await delay(delayMs);
      }
      try {
        await fetchWithFallback('/report', payload);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error('Unable to submit feedback.');
  };

  return {
    addFeedbackHistoryEntry,
    updateFeedbackHistoryEntry,
    queueFeedbackReport,
    schedulePendingFlush,
    flushPendingFeedback,
    initializePendingFeedback,
    sendFeedbackPayload
  };
};
