// TODO: After starting backend, replace API_KEY with the printed key

const API_BASES = [
  'https://localhost:5000',
  ...(typeof window !== 'undefined' && window.location?.protocol !== 'https:' ? ['http://localhost:5000'] : [])
];

export const DEFAULT_THRESHOLD = 0.8;
export const TEXT_SELECTORS = [
  'div[data-testid="tweetText"]',
  'div[role="textbox"]',
  'div[contenteditable="true"]',
  'p',
  'blockquote',
  'li',
  'span'
];
export const PRIMARY_TEXT_SELECTOR = TEXT_SELECTORS[0];
export const TARGET_SELECTORS = TEXT_SELECTORS.join(', ');
export const SOCIAL_BLOCK_SELECTORS = ['article', '[data-testid="tweet"]', '[role="article"]', '[role="gridcell"]', '[role="listitem"]'];
export const BASE_SCAN_SELECTOR = `${SOCIAL_BLOCK_SELECTORS.join(', ')}, ${TARGET_SELECTORS}`;
export const MIN_TEXT_LENGTH = 5;
export const PROCESSED_FLAG = 'processed';
export const DISMISSED_FLAG = 'dismissed';
export const STYLE_ID = 'deb-hate-style';
export const HIGHLIGHT_CLASS = 'deb-hate-highlight';
export const TOOLTIP_CLASS = 'deb-hate-tooltip';
export const TOOLTIP_META_CLASS = 'deb-hate-tooltip__meta';
export const TOOLTIP_BADGE_CLASS = 'deb-hate-tooltip__badge';
export const TOOLTIP_SCORE_CLASS = 'deb-hate-tooltip__score';
export const TOOLTIP_ACTIONS_CLASS = 'deb-hate-tooltip__actions';
export const TOOLTIP_BUTTON_CLASS = 'deb-hate-tooltip__btn';
export const INLINE_HIGHLIGHT_CLASS = 'deb-hate-inline';
export const HIGHLIGHT_STYLE_OPTIONS = ['highlight', 'blur', 'redact'];
export const DEFAULT_STYLE = 'highlight';
export const FEEDBACK_PREFIX = '[DeBERTa Detector]';
export const STORAGE_KEYS = {
  pendingReports: 'debPendingReports',
  feedbackHistory: 'debFeedbackHistory'
};
export const MAX_FEEDBACK_HISTORY = 50;
export const FEEDBACK_RETRY_ATTEMPTS = 3;
export const FEEDBACK_RETRY_DELAYS = [0, 1000, 3000];

export const CONFIG = {
  API_KEY: '2zaTO484HV8VNFSzkSj7J3q2rwSr7w9ymI3B6F-8Ohg',
  API_BASES,
  DEFAULT_THRESHOLD,
  TEXT_SELECTORS,
  PRIMARY_TEXT_SELECTOR,
  TARGET_SELECTORS,
  SOCIAL_BLOCK_SELECTORS,
  BASE_SCAN_SELECTOR,
  MIN_TEXT_LENGTH,
  PROCESSED_FLAG,
  DISMISSED_FLAG,
  STYLE_ID,
  HIGHLIGHT_CLASS,
  TOOLTIP_CLASS,
  TOOLTIP_META_CLASS,
  TOOLTIP_BADGE_CLASS,
  TOOLTIP_SCORE_CLASS,
  TOOLTIP_ACTIONS_CLASS,
  TOOLTIP_BUTTON_CLASS,
  INLINE_HIGHLIGHT_CLASS,
  HIGHLIGHT_STYLE_OPTIONS,
  DEFAULT_STYLE,
  FEEDBACK_PREFIX,
  STORAGE_KEYS,
  MAX_FEEDBACK_HISTORY,
  FEEDBACK_RETRY_ATTEMPTS,
  FEEDBACK_RETRY_DELAYS
};

export { API_BASES };
