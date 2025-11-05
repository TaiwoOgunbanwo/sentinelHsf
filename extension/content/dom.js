const createDomHelpers = (config) => {
  const sanitizeText = (value) => (value || '').replace(/\s+/g, ' ').trim();

  const pickPreferredDescendant = (root) => {
    for (const selector of config.textSelectors) {
      const candidate = root.querySelector?.(selector);
      if (candidate) {
        const text = sanitizeText(candidate.textContent);
        if (text.length >= config.minTextLength) {
          return candidate;
        }
      }
    }
    return null;
  };

  const findHighlightTarget = (element) => {
    if (!(element instanceof Element)) {
      return null;
    }

    if (element === document.body || element === document.documentElement) {
      return null;
    }

    if (element.matches?.(config.primaryTextSelector)) {
      return element;
    }

    if (element.matches?.(config.targetSelectors)) {
      const container = element.closest?.(config.primaryTextSelector);
      return container || element;
    }

    const descendant = pickPreferredDescendant(element);
    if (descendant) {
      return descendant;
    }

    const ancestor = element.closest?.(config.socialBlockSelectors.join(', '));
    if (ancestor) {
      const preferred = pickPreferredDescendant(ancestor);
      return preferred || (ancestor.matches?.(config.targetSelectors) ? ancestor : null);
    }

    return null;
  };

  const splitIntoSentences = (text) => {
    if (!text) {
      return [];
    }

    const sentences = [];
    const regex = /[^.!?]+[.!?]*/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const raw = match[0];
      const clean = sanitizeText(raw);
      if (!clean || clean.length < config.minTextLength) {
        continue;
      }
      const leading = raw.match(/^\s*/)?.[0].length ?? 0;
      const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
      sentences.push({
        raw,
        clean,
        start: match.index + leading,
        end: match.index + raw.length - trailing
      });
    }

    if (sentences.length === 0) {
      const clean = sanitizeText(text);
      if (clean.length >= config.minTextLength) {
        sentences.push({ raw: text, clean, start: 0, end: text.length });
      }
    }

    return sentences;
  };

  const makeRedactLabel = (text) => {
    const length = Math.max(3, Math.min(12, Math.round((text?.length || 0) / 4) || 3));
    return (config.redactChar || '█').repeat(length);
  };

  const collectTextNodes = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let offset = 0;
    let current;
    while ((current = walker.nextNode())) {
      const value = current.nodeValue ?? '';
      nodes.push({ node: current, start: offset, end: offset + value.length });
      offset += value.length;
    }
    return nodes;
  };

  const findPositionInNodes = (nodes, offset) => {
    for (const entry of nodes) {
      if (offset >= entry.start && offset <= entry.end) {
        return { node: entry.node, offset: Math.max(0, offset - entry.start) };
      }
    }
    return null;
  };

  const highlightRange = (element, start, end, styleMode = config.defaultStyle) => {
    if (start >= end) {
      return null;
    }

    const nodes = collectTextNodes(element);
    if (nodes.length === 0) {
      return null;
    }

    const range = document.createRange();
    const startPos = findPositionInNodes(nodes, start);
    const endPos = findPositionInNodes(nodes, end);

    if (!startPos || !endPos) {
      return null;
    }

    try {
      range.setStart(startPos.node, Math.max(0, Math.min(startPos.node.nodeValue.length, startPos.offset)));
      range.setEnd(endPos.node, Math.max(0, Math.min(endPos.node.nodeValue.length, endPos.offset)));
    } catch (error) {
      return null;
    }

    const style = config.highlightStyleOptions.includes(styleMode) ? styleMode : config.defaultStyle;
    const selectedText = sanitizeText(range.toString());
    const inlineClass = config.inlineHighlightClass || 'deb-hate-inline';
    const wrapper = document.createElement('span');
    wrapper.classList.add(inlineClass, `${inlineClass}--${style}`);
    if (style === 'redact') {
      wrapper.dataset.redact = makeRedactLabel(selectedText);
      wrapper.setAttribute('title', 'Click or hover to reveal redacted text');
    }
    if (style === 'blur') {
      wrapper.setAttribute('title', 'Hover to reveal blurred text');
    }

    try {
      const contents = range.extractContents();
      wrapper.appendChild(contents);
      range.insertNode(wrapper);
    } catch (error) {
      return null;
    }

    return wrapper;
  };

  const unwrapWrappers = (wrappers = []) => {
    wrappers.forEach((wrapper) => {
      if (!wrapper || !wrapper.parentNode) {
        return;
      }
      const parent = wrapper.parentNode;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      parent.removeChild(wrapper);
    });
  };

  const resolveStableIdentifier = (element) => {
    if (!(element instanceof Element)) {
      return null;
    }

    const attributeKeys = ['data-tweet-id', 'data-item-id', 'data-id', 'id'];
    for (const attr of attributeKeys) {
      const val = element.getAttribute?.(attr);
      if (val) {
        return `${attr}:${val}`;
      }
    }

    const statusLink = element.querySelector?.('a[href*="/status/"]');
    if (statusLink) {
      try {
        const url = new URL(statusLink.getAttribute('href'), window.location.origin);
        return `status:${url.pathname}`;
      } catch (error) {
        // ignore malformed URLs
      }
    }

    const aria = element.getAttribute?.('aria-describedby');
    if (aria) {
      return `aria:${aria}`;
    }

    return null;
  };

  const buildSignature = (element, text) => {
    if (!element) {
      return null;
    }
    const stable = resolveStableIdentifier(element);
    if (stable) {
      return `${window.location.hostname}:${stable}`;
    }
    const fallbackText = typeof text === 'string' ? text : (element.innerText ?? element.textContent ?? '');
    const normalized = fallbackText.trim().toLowerCase();
    if (!normalized) {
      const selectors = [
        element.getAttribute?.('data-testid'),
        element.getAttribute?.('role'),
        element.className && String(element.className).split(/\s+/).filter(Boolean).join('.')
      ].filter(Boolean);
      if (selectors.length) {
        return `${window.location.hostname}:fallback:${selectors.join(':')}`;
      }
      return `${window.location.hostname}:fallback:${Date.now()}`;
    }
    return `${window.location.hostname}:${normalized}`;
  };

  return {
    sanitizeText,
    pickPreferredDescendant,
    findHighlightTarget,
    splitIntoSentences,
    makeRedactLabel,
    collectTextNodes,
    findPositionInNodes,
    highlightRange,
    unwrapWrappers,
    resolveStableIdentifier,
    buildSignature
  };
};

export { createDomHelpers };
