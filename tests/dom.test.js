import { JSDOM } from 'jsdom';
import { createDomHelpers } from '../extension/content/dom.js';

const setupHelpers = () => {
  const config = {
    textSelectors: ['p', 'span'],
    primaryTextSelector: 'p',
    targetSelectors: 'p, span',
    socialBlockSelectors: ['article'],
    minTextLength: 3,
    defaultStyle: 'highlight',
    highlightStyleOptions: ['highlight', 'blur', 'redact'],
    inlineHighlightClass: 'deb-hate-inline'
  };
  return createDomHelpers(config);
};

describe('dom helpers', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
  });

  test('splitIntoSentences splits and trims text', () => {
    const helpers = setupHelpers();
    const sentences = helpers.splitIntoSentences('This is sentence one. And sentence two!');
    expect(sentences).toHaveLength(2);
    expect(sentences[0].clean).toBe('This is sentence one.');
    expect(sentences[1].clean).toBe('And sentence two!');
    expect(sentences[0].start).toBe(0);
    expect(sentences[1].start).toBeGreaterThan(sentences[0].start);
  });

  test('makeRedactLabel respects length bounds', () => {
    const helpers = setupHelpers();
    const short = helpers.makeRedactLabel('ok');
    const medium = helpers.makeRedactLabel('This is a longer snippet of text');
    expect(short.length).toBeGreaterThanOrEqual(3);
    expect(medium.length).toBeLessThanOrEqual(12);
  });

  test('highlightRange injects wrapper with style class', () => {
    const helpers = setupHelpers();
    document.body.innerHTML = '<article><p id="post">This is hateful content example.</p></article>';
    const element = document.getElementById('post');
    const wrapper = helpers.highlightRange(element, 5, 12, 'blur');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.classList.contains('deb-hate-inline')).toBe(true);
    expect(wrapper?.classList.contains('deb-hate-inline--blur')).toBe(true);
    expect(wrapper?.textContent).toBe('is hate');
  });

  test('buildSignature prefers stable attributes', () => {
    const helpers = setupHelpers();
    document.body.innerHTML = '<article><p id="post" data-tweet-id="123">Example text</p></article>';
    const element = document.getElementById('post');
    const signature = helpers.buildSignature(element, 'Example text');
    expect(signature).toContain('data-tweet-id:123');
  });
});
