const { config } = require('./config');

function countMentions(text) {
  const matches = text.match(/<@[!&]?\d+>|@everyone|@here/gu); // user pings <@id>/<@!id>, role pings <@&id>, and mass pings
  return matches ? matches.length : 0;
}

function neutralizeMassMentions(text) { // makes @everyone/@here harmless text instead of a server-wide ping
  return String(text || '').replace(/@(everyone|here)\b/giu, '@​$1'); // a zero-width space after @ stops Discord treating it as a mention
}

function containsInviteLink(text) {
  return /(discord\.gg|discord\.com\/invite)\//iu.test(text);
}

function buildBlocklistRegex() {
  if (!Array.isArray(config.moderationBlocklist) || config.moderationBlocklist.length === 0) {
    return null;
  }

  const escaped = config.moderationBlocklist
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));

  if (escaped.length === 0) {
    return null;
  }

  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'iu');
}

const blocklistRegex = buildBlocklistRegex();

function evaluateIncomingMessage(text) {
  if (!config.moderationEnabled) {
    return { allowed: true, reason: 'disabled' };
  }

  const normalized = String(text || '').trim();
  if (!normalized) {
    return { allowed: false, reason: 'empty' };
  }

  if (normalized.length > config.moderationMaxInputChars) {
    return { allowed: false, reason: 'too-long' };
  }

  if (blocklistRegex && blocklistRegex.test(normalized)) {
    return { allowed: false, reason: 'blocklist' };
  }

  if (config.moderationBlockInviteLinks && containsInviteLink(normalized)) {
    return { allowed: false, reason: 'invite-link' };
  }

  return { allowed: true, reason: 'ok' };
}

// options.preserveWhitespace: keep newlines/formatting (welcome cards, search results, starboard) instead of flattening to one line
// options.maxChars: length cap for this caller (defaults to MODERATION_MAX_OUTPUT_CHARS, which is sized for chat replies)
function evaluateOutgoingMessage(text, options = {}) {
  const safeText = neutralizeMassMentions(text); // @everyone/@here are defused ALWAYS, even when moderation is switched off
  if (!config.moderationEnabled) {
    return { allowed: true, reason: 'disabled', text: safeText.trim() };
  }

  let normalized = options.preserveWhitespace // pick how to tidy the text
    ? safeText.replace(/[ \t]+\n/gu, '\n').trim() // keep line breaks, just trim trailing spaces on each line
    : safeText.replace(/\s+/gu, ' ').trim(); // chat replies: squash everything onto one line (old behaviour)
  if (!normalized) {
    return { allowed: false, reason: 'empty', text: '' };
  }

  const maxChars = Number.isFinite(options.maxChars) && options.maxChars > 0 ? options.maxChars : config.moderationMaxOutputChars; // per-caller cap or the global one
  if (normalized.length > maxChars) {
    normalized = `${normalized.slice(0, Math.max(1, maxChars - 3)).trim()}...`; // cut and add an ellipsis
  }

  if (countMentions(normalized) > config.moderationMaxMentions) {
    return { allowed: false, reason: 'too-many-mentions', text: '' };
  }

  if (blocklistRegex && blocklistRegex.test(normalized)) {
    return { allowed: false, reason: 'blocklist', text: '' };
  }

  return { allowed: true, reason: 'ok', text: normalized };
}

module.exports = {
  evaluateIncomingMessage,
  evaluateOutgoingMessage,
};
