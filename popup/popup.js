const { api, newRule, loadSettings, saveSettings, regexError } = globalThis.LPVB;

const HOSTS = ['https://x.com/*', 'https://twitter.com/*', 'https://mobile.x.com/*', 'https://mobile.twitter.com/*'];
const X_TAB_RE = /^https:\/\/(?:mobile\.)?(?:x|twitter)\.com\//;
const $ = (sel) => document.querySelector(sel);
let settings = null;
let saveTimer = 0;

// Typing is debounced so half-typed terms ("c", "cr"…) don't briefly collapse
// the feed; anything pending is flushed when the popup closes.
function save({ debounce = false } = {}) {
  clearTimeout(saveTimer);
  if (debounce) saveTimer = setTimeout(flush, 400);
  else flush();
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (settings) saveSettings(settings);
}

window.addEventListener('pagehide', () => saveTimer && flush());
document.addEventListener('visibilitychange', () => document.hidden && saveTimer && flush());

// ---- Rules ---------------------------------------------------------------

function renderRules() {
  const list = $('#rules');
  list.replaceChildren();
  if (!settings.rules.length) {
    list.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'No rules yet. Add one below.' }));
  }
  for (const rule of settings.rules) list.append(renderRule(rule));
}

function renderRule(rule) {
  const row = $('#rule-template').content.firstElementChild.cloneNode(true);
  const q = (sel) => row.querySelector(sel);

  const enabled = q('.rule-enabled');
  enabled.checked = rule.enabled;
  row.toggleAttribute('data-off', !rule.enabled);
  enabled.addEventListener('change', () => {
    rule.enabled = enabled.checked;
    row.toggleAttribute('data-off', !rule.enabled);
    save();
  });

  const error = q('.rule-error');
  const validate = () => {
    error.textContent = rule.regex ? regexError(rule.regex) || '' : '';
  };
  for (const [sel, key] of [['.rule-name', 'name'], ['.rule-terms', 'terms'], ['.rule-regex', 'regex']]) {
    const input = q(sel);
    input.value = rule[key];
    input.addEventListener('input', () => {
      rule[key] = input.value;
      validate();
      save({ debounce: true });
    });
  }
  // Regexes are for the settings page; only show one here if the rule has it.
  q('.rule-regex').hidden = !rule.regex;
  validate();

  const flags = q('[data-flags]');
  flags.setAttribute('aria-pressed', String(rule.flags));
  flags.addEventListener('click', () => {
    rule.flags = !rule.flags;
    flags.setAttribute('aria-pressed', String(rule.flags));
    save();
  });

  for (const chip of row.querySelectorAll('[data-field]')) {
    const field = chip.dataset.field;
    chip.setAttribute('aria-pressed', String(rule.fields.includes(field)));
    chip.addEventListener('click', () => {
      const on = rule.fields.includes(field);
      if (on && rule.fields.length === 1) return; // a rule must look somewhere
      rule.fields = on ? rule.fields.filter((f) => f !== field) : [...rule.fields, field];
      chip.setAttribute('aria-pressed', String(!on));
      save();
    });
  }

  q('.rule-delete').addEventListener('click', () => {
    settings.rules = settings.rules.filter((r) => r !== rule);
    renderRules();
    save();
  });
  return row;
}

$('#add-rule').addEventListener('click', () => {
  settings.rules.push(newRule());
  renderRules();
  $('#rules').lastElementChild.querySelector('.rule-name').focus();
  save();
});

// ---- Status for the current tab --------------------------------------------

function setStatus(text, tone = '', action = null) {
  const el = $('#status');
  el.replaceChildren(text);
  el.dataset.tone = tone;
  if (action) {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: action.label });
    button.addEventListener('click', action.run);
    el.append(button);
  }
}

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshStatus() {
  const granted = await api.permissions.contains({ origins: HOSTS }).catch(() => true);
  if (!granted) {
    // Firefox may leave MV3 site access off until you allow it. request() has to
    // run straight from the click, so no awaits before it.
    return setStatus("Can't run on x.com yet.", 'warn', {
      label: 'Allow on x.com',
      run: () => api.permissions.request({ origins: HOSTS }).then(refreshStatus),
    });
  }
  const tab = await activeTab();
  if (!X_TAB_RE.test(tab?.url || '')) return setStatus('Open x.com to see hidden posts.');
  try {
    const report = await api.tabs.sendMessage(tab.id, { type: 'lpvb:report' });
    const n = report.articles.hidden;
    setStatus(`${n} post${n === 1 ? '' : 's'} hidden on this page.`);
  } catch {
    setStatus('Not running in this tab yet.', 'warn', {
      label: 'Refresh tab',
      run: () => api.tabs.reload(tab.id).then(() => window.close()),
    });
  }
}

// ---- Wiring ----------------------------------------------------------------

loadSettings().then((loaded) => {
  settings = loaded;
  for (const key of ['enabled', 'skipFollowing']) {
    const box = document.getElementById(key);
    box.checked = settings[key];
    box.addEventListener('change', () => {
      settings[key] = box.checked;
      save();
    });
  }
  renderRules();
});

refreshStatus();

$('#open-options').addEventListener('click', () => {
  flush();
  api.runtime.openOptionsPage();
  window.close();
});

$('#debug').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  try {
    const report = await api.tabs.sendMessage((await activeTab()).id, { type: 'lpvb:report' });
    await navigator.clipboard.writeText(JSON.stringify(report, null, 1));
    button.textContent = 'Copied. Paste it to Claude.';
  } catch {
    button.textContent = 'Open an x.com tab first';
  }
});
