// Rule engine and settings helpers shared by the content script, popup and options page.
// Loaded as a classic script; everything hangs off the `LPVB` global.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  const FIELDS = ['name', 'bio', 'location'];

  // Any flag emoji, longest forms first:
  //   🏴󠁧󠁢󠁥󠁮󠁧󠁿 subdivision flags (tag sequences), 🏳️‍🌈 🏳️‍⚧️ 🏴‍☠️ ZWJ flags,
  //   🇺🇸 country flags (regional indicator pairs), 🏳️ 🏴 🏁 🚩 🎌 single flags.
  const FLAG_RE =
    /\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F}|[\u{1F3F3}\u{1F3F4}]\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)+|\p{Regional_Indicator}{2}|[\u{1F3F3}\u{1F3F4}\u{1F3C1}\u{1F6A9}\u{1F38C}]\uFE0F?/gu;
  const WORDY_RE = /[\p{L}\p{N}]/u;

  // A rule is a named set of things to look for in a profile: specific emoji or
  // words, any flag emoji, and/or a regular expression.
  const DEFAULT_SETTINGS = {
    enabled: true,
    skipFollowing: true,
    rules: [{ id: 'default-flags', name: 'Flags', terms: '', flags: true, regex: '', fields: ['name', 'bio'], enabled: true }],
    allowlist: [],
  };

  function newRuleId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function newRule() {
    return { id: newRuleId(), name: '', terms: '', flags: false, regex: '', fields: ['name', 'bio'], enabled: true };
  }

  const text = (v) => (typeof v === 'string' ? v : '');

  function normalizeRule(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const rule = {
      id: text(raw.id) || newRuleId(),
      name: text(raw.name),
      terms: text(raw.terms),
      flags: raw.flags === true,
      regex: text(raw.regex),
      fields: Array.isArray(raw.fields) ? FIELDS.filter((f) => raw.fields.includes(f)) : ['name', 'bio'],
      enabled: raw.enabled !== false,
    };
    // Rules saved by 1.0–1.2 had a single type and value.
    if (raw.type === 'flags') Object.assign(rule, { flags: true, name: rule.name || 'Flags' });
    else if (raw.type === 'text') rule.terms = text(raw.value);
    else if (raw.type === 'regex') rule.regex = text(raw.value);
    return rule;
  }

  function normalizeSettings(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: s.enabled !== false,
      skipFollowing: s.skipFollowing !== false,
      rules: Array.isArray(s.rules)
        ? s.rules.map(normalizeRule).filter(Boolean)
        : structuredClone(DEFAULT_SETTINGS.rules),
      allowlist: Array.isArray(s.allowlist) ? parseHandles(s.allowlist.join(' ')) : [],
    };
  }

  // Accepts "@foo, bar https://x.com/baz" and returns ["foo", "bar", "baz"].
  function parseHandles(text) {
    const out = [];
    for (let token of String(text).split(/[\s,]+/)) {
      token = token
        .replace(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i, '')
        .replace(/^@/, '')
        .replace(/[/?#].*$/, '')
        .toLowerCase();
      if (/^\w{1,15}$/.test(token) && !out.includes(token)) out.push(token);
    }
    return out;
  }

  async function loadSettings() {
    const { settings } = await api.storage.local.get('settings');
    return normalizeSettings(settings ?? DEFAULT_SETTINGS);
  }

  function saveSettings(settings) {
    return api.storage.local.set({ settings: normalizeSettings(settings) });
  }

  function onSettingsChanged(callback) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) callback(normalizeSettings(changes.settings.newValue));
    });
  }

  // Lowercase, fold stylised letters (𝓬𝓻𝔂𝓹𝓽𝓸 → crypto) and drop emoji variation
  // selectors so "❤" matches "❤️".
  function fold(text) {
    return text.normalize('NFKC').toLowerCase().replace(/\uFE0F/g, '');
  }

  function splitTerms(value) {
    return value.split(',').map((t) => t.trim()).filter(Boolean);
  }

  const regexCache = new Map();
  function compileRegex(source) {
    if (!regexCache.has(source)) {
      let re = null;
      try {
        re = source ? new RegExp(source, 'iu') : null;
      } catch {}
      regexCache.set(source, re);
    }
    return regexCache.get(source);
  }

  function regexError(source) {
    try {
      new RegExp(source, 'iu');
      return null;
    } catch (e) {
      return e.message;
    }
  }

  function clip(text, max = 30) {
    text = text.replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  // What a post's bar says hid it: the rule's name, or a summary of what it matches.
  function ruleLabel(rule) {
    if (rule.name.trim()) return rule.name.trim();
    const parts = [];
    if (rule.flags) parts.push('Any flag');
    const terms = splitTerms(rule.terms);
    if (terms.length) parts.push(clip(terms.slice(0, 3).join(', ') + (terms.length > 3 ? ', …' : '')));
    if (rule.regex) parts.push(`/${clip(rule.regex, 20)}/`);
    return parts.join(' + ') || 'Unnamed rule';
  }

  function show(hit) {
    return WORDY_RE.test(hit) ? `"${clip(hit)}"` : hit;
  }

  function fieldText(profile, field) {
    if (field === 'name') return [profile.name, profile.handle && '@' + profile.handle].filter(Boolean).join(' ');
    return profile[field] || '';
  }

  function ruleHits(rule, text) {
    const hits = [];
    if (rule.flags) hits.push(...(text.match(FLAG_RE) || []));
    const terms = splitTerms(rule.terms);
    if (terms.length) {
      const hay = fold(text);
      hits.push(...terms.filter((t) => hay.includes(fold(t))));
    }
    const match = rule.regex && compileRegex(rule.regex)?.exec(text);
    if (match && match[0]) hits.push(match[0]);
    return [...new Set(hits)];
  }

  // Every enabled rule that matches the profile, as { label, details } where
  // details says what was found where ("🇺🇸 🇧🇷 in name"). Empty means the post stays visible.
  function evaluate(profile, rules) {
    const matches = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const details = [];
      for (const field of rule.fields) {
        const hits = ruleHits(rule, fieldText(profile, field));
        if (hits.length) details.push(`${hits.map(show).join(' ')} in ${field}`);
      }
      if (details.length) matches.push({ label: ruleLabel(rule), details });
    }
    return matches;
  }

  // ---- Reading X's data -------------------------------------------------

  function expandUrls(text, urls) {
    if (!Array.isArray(urls)) return text;
    for (const u of urls) {
      if (u && u.url && u.expanded_url) text = text.split(u.url).join(u.expanded_url);
    }
    return text;
  }

  const str = (...values) => values.find((v) => typeof v === 'string') ?? null;
  const bool = (...values) => values.find((v) => typeof v === 'boolean') ?? null;

  // Recognises GraphQL user results from both of X's frontends
  // ({ rest_id, core, legacy | profile_bio, ... }) and v1.1 user objects
  // ({ id_str, screen_name, description, ... }). Fields a payload doesn't carry
  // come back null so they never overwrite data we already have.
  function toUser(o) {
    let handle, name, bio, location, following, urls;
    if (typeof o.rest_id === 'string' && (o.legacy || o.core)) {
      const legacy = o.legacy || {};
      const core = o.core || {};
      handle = str(core.screen_name, legacy.screen_name);
      name = str(core.name, legacy.name);
      bio = str(legacy.description, o.profile_bio?.description);
      location = str(o.location?.location, legacy.location);
      following = bool(o.relationship_perspectives?.following, legacy.following);
      urls = legacy.entities?.description?.urls ?? o.profile_bio?.entities?.description?.urls;
    } else if (typeof o.id_str === 'string' && typeof o.screen_name === 'string' && 'description' in o) {
      handle = o.screen_name;
      name = str(o.name);
      bio = str(o.description);
      location = str(o.location);
      following = bool(o.following);
      urls = o.entities?.description?.urls;
    }
    if (!handle) return null;
    if (bio) bio = expandUrls(bio, urls);
    return { handle, name, bio, location, following };
  }

  // Walks any API payload and returns every user profile in it.
  function extractUsers(root) {
    const found = new Map();
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) {
        for (const v of node) stack.push(v);
        continue;
      }
      const user = toUser(node);
      if (user) {
        const key = user.handle.toLowerCase();
        const prev = found.get(key);
        if (prev) for (const f in user) user[f] ??= prev[f];
        found.set(key, user);
      }
      for (const key in node) {
        const v = node[key];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
    return [...found.values()];
  }

  // Field names of the richest user object in a payload, for debug reports.
  function userKeySample(root) {
    let best = null;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.__typename === 'User' && (!best || Object.keys(node).length > best.length)) best = Object.keys(node);
      for (const key in node) if (node[key] && typeof node[key] === 'object') stack.push(node[key]);
    }
    return best;
  }

  const JS_ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
  function decodeJsString(literal) {
    return literal.replace(/\\(?:x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|([\s\S]))/g, (_, x, cp, u, ch) =>
      x ? String.fromCharCode(parseInt(x, 16))
        : cp ? String.fromCodePoint(parseInt(cp, 16))
        : u ? String.fromCharCode(parseInt(u, 16))
        : JS_ESCAPES[ch] ?? ch,
    );
  }

  // X's newer frontend server-renders profile pages with the GraphQL results
  // embedded as JSON string literals: value:"{\"data\":{...}}".
  function profilePageBlobs(html) {
    const blobs = [];
    for (const m of html.matchAll(/value:"(\{\\"data\\":(?:[^"\\]|\\.)*)"/g)) {
      try {
        blobs.push(JSON.parse(decodeJsString(m[1])));
      } catch {}
    }
    return blobs;
  }

  globalThis.LPVB = {
    api,
    FIELDS,
    DEFAULT_SETTINGS,
    newRule,
    normalizeSettings,
    parseHandles,
    loadSettings,
    saveSettings,
    onSettingsChanged,
    regexError,
    ruleLabel,
    evaluate,
    extractUsers,
    userKeySample,
    profilePageBlobs,
  };
})();
