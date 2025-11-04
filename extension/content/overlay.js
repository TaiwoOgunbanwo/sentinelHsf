const createOverlayManager = ({
  classes,
  dom,
  feedback,
  notifyExtension,
  processedSignatures,
  setScanState,
  flags,
  defaultStyle
}) => {
  const overlayRegistry = new Map();
  let overlayListenersActive = false;
  let overlayUpdateQueued = false;
  const dismissedFlag = flags?.dismissed ?? 'dismissed';

  const textSnippet = (text) => {
    if (!text) {
      return '';
    }
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  };

  const formatScore = (score) => (typeof score === 'number' ? score.toFixed(2) : 'n/a');

  const ensureStyles = () => {
    if (document.getElementById(classes.styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = classes.styleId;
    style.textContent = `
      .${classes.highlightClass} {
        position: relative;
      }
      .${classes.inlineHighlightClass} {
        position: relative;
        display: inline-block;
        padding: 0 2px;
        border-radius: 6px;
        transition: background 0.2s ease, filter 0.2s ease, color 0.2s ease, text-shadow 0.2s ease;
      }
      .${classes.inlineHighlightClass}--highlight {
        background: linear-gradient(120deg, rgba(223, 41, 53, 0.18), rgba(223, 41, 53, 0.08));
        color: inherit;
        box-shadow: 0 2px 10px rgba(223, 41, 53, 0.25);
      }
      .${classes.inlineHighlightClass}--highlight:hover {
        box-shadow: 0 3px 14px rgba(223, 41, 53, 0.35);
        background: linear-gradient(120deg, rgba(223, 41, 53, 0.28), rgba(223, 41, 53, 0.12));
      }
      .${classes.inlineHighlightClass}--blur {
        filter: blur(6px);
        cursor: pointer;
      }
      .${classes.inlineHighlightClass}--blur[data-revealed="true"] {
        filter: none;
      }
      .${classes.inlineHighlightClass}--redact {
        color: transparent;
        background: rgba(17, 24, 39, 0.92);
        cursor: pointer;
      }
      .${classes.inlineHighlightClass}--redact::after {
        content: attr(data-redact);
        color: #f9fafb;
        letter-spacing: 0.12em;
        font-size: 0.75em;
        opacity: 0.85;
        display: inline-block;
        vertical-align: middle;
      }
      .${classes.inlineHighlightClass}--redact[data-revealed="true"] {
        color: inherit;
        background: rgba(223, 41, 53, 0.12);
      }
      .${classes.inlineHighlightClass}--redact[data-revealed="true"]::after {
        content: '';
      }
      .deb-hate-inline-controls {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
        font-size: 0.75em;
      }
      .deb-hate-inline-controls button {
        border: none;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: inherit;
      }
      .deb-hate-control {
        background: rgba(223, 41, 53, 0.95);
        color: #fff;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .deb-hate-control:hover,
      .deb-hate-control:focus {
        background: rgba(223, 41, 53, 1);
        outline: none;
      }
      .deb-hate-control-action {
        background: rgba(75, 85, 99, 0.9);
        color: #f9fafb;
        margin-left: 6px;
      }
      .deb-hate-control-action:hover,
      .deb-hate-control-action:focus {
        background: rgba(55, 65, 81, 0.95);
        outline: none;
      }
      .${classes.tooltipClass} {
        position: absolute;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 12px;
        background: rgba(17, 24, 39, 0.92);
        color: #ffffff;
        border-radius: 10px;
        box-shadow: 0 14px 30px rgba(17, 24, 39, 0.35);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        line-height: 1.4;
        pointer-events: auto;
        max-width: min(320px, 80vw);
        border: 1px solid rgba(223, 41, 53, 0.4);
        padding-right: 12px;
      }
      .${classes.tooltipClass}::after {
        content: '';
        position: absolute;
        bottom: -8px;
        right: 18px;
        border-width: 8px 8px 0 8px;
        border-style: solid;
        border-color: rgba(17, 24, 39, 0.92) transparent transparent transparent;
        filter: drop-shadow(0 2px 4px rgba(17, 24, 39, 0.25));
      }
      .${classes.tooltipClass} * {
        box-sizing: border-box;
      }
      .${classes.tooltipMetaClass} {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .${classes.tooltipBadgeClass} {
        background: #df2935;
        color: #ffffff;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-weight: 600;
      }
      .${classes.tooltipScoreClass} {
        opacity: 0.7;
        font-size: 11px;
      }
      .${classes.tooltipActionsClass} {
        display: grid;
        grid-auto-flow: column;
        gap: 6px;
      }
      .${classes.tooltipButtonClass} {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.4);
        border-radius: 6px;
        color: #ffffff;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 11px;
        transition: background 0.18s ease, border-color 0.18s ease;
      }
      .${classes.tooltipButtonClass}:hover {
        background: rgba(223, 41, 53, 0.2);
        border-color: rgba(223, 41, 53, 0.8);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const updateTooltipPosition = (host, container) => {
    if (!document.body.contains(host)) {
      container.remove();
      overlayRegistry.delete(host);
      return;
    }

    const rect = host.getBoundingClientRect();
    if ((rect.width === 0 && rect.height === 0) || !container.offsetParent) {
      container.style.visibility = 'hidden';
      return;
    }

    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
    const preferredTop = scrollY + rect.top - container.offsetHeight - 8;
    const fallbackTop = scrollY + rect.bottom + 8;
    const viewportTop = scrollY + 8;
    const top = preferredTop < viewportTop ? fallbackTop : preferredTop;

    const viewportLeft = scrollX + 12;
    const viewportRight = scrollX + document.documentElement.clientWidth - container.offsetWidth - 12;
    let left = scrollX + rect.left + rect.width - container.offsetWidth;
    if (left < viewportLeft) {
      left = viewportLeft;
    }
    if (left > viewportRight) {
      left = viewportRight;
    }

    container.style.visibility = 'visible';
    container.style.position = 'absolute';
    container.style.top = `${top}px`;
    container.style.left = `${left}px`;
  };

  const scheduleOverlayUpdate = () => {
    if (overlayRegistry.size === 0) {
      if (overlayListenersActive) {
        window.removeEventListener('scroll', scheduleOverlayUpdate);
        window.removeEventListener('resize', scheduleOverlayUpdate);
        overlayListenersActive = false;
      }
      return;
    }

    if (!overlayListenersActive) {
      window.addEventListener('scroll', scheduleOverlayUpdate, { passive: true });
      window.addEventListener('resize', scheduleOverlayUpdate);
      overlayListenersActive = true;
    }

    if (overlayUpdateQueued) {
      return;
    }

    overlayUpdateQueued = true;
    requestAnimationFrame(() => {
      overlayUpdateQueued = false;
      overlayRegistry.forEach(({ container, host }) => updateTooltipPosition(host, container));
      if (overlayRegistry.size === 0 && overlayListenersActive) {
        window.removeEventListener('scroll', scheduleOverlayUpdate);
        window.removeEventListener('resize', scheduleOverlayUpdate);
        overlayListenersActive = false;
      }
    });
  };

  const removeHighlight = (el) => {
    if (!el) {
      return;
    }
    el.classList.remove(classes.highlightClass);
    const entry = overlayRegistry.get(el);
    if (entry) {
      dom.unwrapWrappers(entry.wrappers ?? []);
      entry.container?.remove?.();
      entry.control?.remove?.();
      overlayRegistry.delete(el);
      scheduleOverlayUpdate();
    } else {
      dom.unwrapWrappers(Array.from(el.querySelectorAll(`.${classes.inlineHighlightClass}`)));
    }
  };

  const attachFeedback = (el, result = {}, wrappers = [], snippets = [], style = defaultStyle, signature) => {
    const existing = overlayRegistry.get(el);
    if (existing) {
      dom.unwrapWrappers(existing.wrappers ?? []);
      existing.container?.remove?.();
      existing.control?.remove?.();
      overlayRegistry.delete(el);
    }

    const rawScore = typeof result?.score === 'number' ? Number(result.score) : null;
    const scoreText = formatScore(rawScore ?? 0);
    const feedbackText = (snippets.length ? snippets.join(' ') : dom.sanitizeText(el.innerText)).slice(0, 4000);

    const logFeedback = async (action, button) => {
      const reportType = action === 'dismiss' ? 'not_hate' : 'flag';
      const originalLabel = button.textContent;
      const payload = {
        text: feedbackText,
        report_type: reportType
      };
      const historyId = `${signature ?? `anon-${Math.random().toString(16).slice(2)}`}:${reportType}:${Date.now()}`;
      const baseHistory = {
        id: historyId,
        action,
        reportType,
        snippet: textSnippet(feedbackText),
        score: rawScore,
        createdAt: Date.now(),
        status: 'pending'
      };
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

      button.disabled = true;
      button.textContent = action === 'dismiss' ? 'Removing…' : 'Sending…';

      const queueReport = async (message) => {
        const queued = await feedback.queueReport?.({
          id: historyId,
          payload,
          history: baseHistory,
          retries: 0,
          lastError: message
        });
        if (queued) {
          await feedback.addHistoryEntry?.({
            ...baseHistory,
            status: 'queued',
            queuedAt: Date.now(),
            lastError: message
          });
          if (typeof notifyExtension === 'function') {
            notifyExtension('feedback-queued', { entryId: historyId });
          }
          button.textContent = 'Queued';
          return false;
        }

        console.error('Failed to queue feedback:', message);
        button.disabled = false;
        button.textContent = originalLabel || 'Retry';
        if (typeof notifyExtension === 'function') {
          notifyExtension('feedback-error', { entryId: historyId, message });
        }
        return false;
      };

      if (offline) {
        return queueReport('Offline');
      }

      try {
        await feedback.sendPayload?.(payload);

        await feedback.addHistoryEntry?.({
          ...baseHistory,
          status: 'sent',
          sentAt: Date.now()
        });

        if (typeof notifyExtension === 'function') {
          notifyExtension('feedback-sent', { entryId: historyId });
        }

        if (action === 'dismiss') {
          if (signature) {
            processedSignatures.delete(signature);
          }
          setScanState(el, dismissedFlag);
          removeHighlight(el);
          button.textContent = 'Removed';
          return true;
        }

        button.textContent = 'Sent';
        return false;
      } catch (error) {
        console.error('Failed to send feedback:', error);
        return queueReport(error?.message ?? 'Request failed.');
      }
    };

    if (style !== 'highlight') {
      if (!wrappers.length) {
        return;
      }

      const normalizedSnippets = snippets.length ? snippets : [dom.sanitizeText(el.innerText)];
      const grouped = new Map();

      wrappers.forEach((wrapper, index) => {
        const snippet = normalizedSnippets[index] ?? normalizedSnippets[normalizedSnippets.length - 1] ?? '';
        wrapper.dataset.revealed = wrapper.dataset.revealed ?? 'false';
        if (style === 'redact') {
          wrapper.dataset.redact = dom.makeRedactLabel(snippet);
        }
        const key = snippet || `group-${index}`;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key).push(wrapper);
      });

      const wrapperGroups = Array.from(grouped.values());

      const controls = document.createElement('div');
      controls.className = 'deb-hate-inline-controls';
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', 'Hate speech controls');

      const isRevealed = wrapperGroups.every((group) => group.every((wrapper) => wrapper.dataset.revealed === 'true'));
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'deb-hate-control';
      toggleBtn.textContent = isRevealed ? `Hide • ${scoreText}` : `Show • ${scoreText}`;
      toggleBtn.setAttribute('aria-pressed', String(isRevealed));
      toggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const reveal = wrapperGroups.some((group) => group.some((wrapper) => wrapper.dataset.revealed !== 'true'));
        wrapperGroups.forEach((group) => {
          group.forEach((wrapper) => {
            wrapper.dataset.revealed = reveal ? 'true' : 'false';
          });
        });
        toggleBtn.setAttribute('aria-pressed', reveal.toString());
        toggleBtn.textContent = reveal ? `Hide • ${scoreText}` : `Show • ${scoreText}`;
      });

      const makeActionButton = (label, action) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'deb-hate-control-action';
        btn.textContent = label;
        btn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const dismissed = await logFeedback(action, btn);
          if (dismissed) {
            controls.remove();
          }
        });
        return btn;
      };

      controls.append(toggleBtn, makeActionButton('Not hate?', 'dismiss'), makeActionButton('Flag', 'flag'));
      const anchor = wrapperGroups[wrapperGroups.length - 1]?.[0];
      if (anchor?.parentNode) {
        anchor.after(controls);
      } else {
        el.appendChild(controls);
      }
      overlayRegistry.set(el, { type: 'block', host: el, wrappers: wrapperGroups.flat(), control: controls, style });
      el.classList.add(classes.highlightClass);
      return;
    }

    const container = document.createElement('div');
    container.className = classes.tooltipClass;
    container.style.visibility = 'hidden';
    const countLabel = result?.count && result.count > 1 ? `${result.label ?? 'HATE'} • ${result.count}` : result?.label ?? 'HATE';
    container.innerHTML = `
      <div class="${classes.tooltipMetaClass}">
        <span class="${classes.tooltipBadgeClass}">${countLabel}</span>
        <span class="${classes.tooltipScoreClass}">Score: ${scoreText}</span>
      </div>
      <div class="${classes.tooltipActionsClass}">
        <button type="button" class="${classes.tooltipButtonClass}" data-action="dismiss">Not hate?</button>
        <button type="button" class="${classes.tooltipButtonClass}" data-action="flag">Flag</button>
      </div>
    `;

    container.querySelectorAll(`.${classes.tooltipButtonClass}`).forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;
        const dismissed = await logFeedback(action, button);
        if (dismissed) {
          container.remove();
          overlayRegistry.delete(el);
        }
      });
    });

    document.body.appendChild(container);
    overlayRegistry.set(el, { type: 'inline', container, host: el, wrappers });
    el.classList.add(classes.highlightClass);
    el.dataset.debFeedbackAttached = 'true';
    scheduleOverlayUpdate();
    requestAnimationFrame(scheduleOverlayUpdate);
  };

  const clearAll = () => {
    const entries = Array.from(overlayRegistry.keys());
    entries.forEach((element) => removeHighlight(element));
    overlayRegistry.clear();
  };

  return {
    ensureStyles,
    scheduleOverlayUpdate,
    removeHighlight,
    attachFeedback,
    clearAll
  };
};

export { createOverlayManager };
