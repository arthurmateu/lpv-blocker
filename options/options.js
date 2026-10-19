const { DEFAULT_SETTINGS, newRule, normalizeSettings, parseHandles, loadSettings, saveSettings, onSettingsChanged, regexError, evaluate } =
  globalThis.LPVB;

const $ = (sel) => document.querySelector(sel);
let state = structuredClone(DEFAULT_SETTINGS);
let saveTimer = 0;
let lastSaved = '';

function showStatus(text) {
  $('#status').textContent = text;
}

function scheduleSave() {
  showStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    state.allowlist = parseHandles($('#allowlist').value);
    lastSaved = JSON.stringify(normalizeSettings(state));
    await saveSettings(state);
    showStatus('Saved');
  }, 300);
  runTester();
}

function renderRules() {
  const list = $('#rules');
  list.replaceChildren();
  if (!state.rules.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No rules yet. Add one below.';
    list.append(empty);
  }
  for (const rule of state.rules) list.append(renderRule(rule));
}

function renderRule(rule) {
  const row = $('#rule-template').content.firstElementChild.cloneNode(true);
  const enabled = row.querySelector('.rule-enabled');
  const error = row.querySelector('.rule-error');

  enabled.checked = rule.enabled;
  enabled.addEventListener('change', () => {
    rule.enabled = enabled.checked;
    scheduleSave();
  });

  const validate = () => {
    error.textContent = rule.regex ? regexError(rule.regex) || '' : '';
  };
  for (const [sel, key] of [['.rule-name', 'name'], ['.rule-terms', 'terms'], ['.rule-regex', 'regex']]) {
    const input = row.querySelector(sel);
    input.value = rule[key];
    input.addEventListener('input', () => {
      rule[key] = input.value;
      validate();
      scheduleSave();
    });
  }
  validate();

  const flags = row.querySelector('.rule-flags input');
  flags.checked = rule.flags;
  flags.addEventListener('change', () => {
    rule.flags = flags.checked;
    scheduleSave();
  });

  for (const box of row.querySelectorAll('.rule-fields input')) {
    box.checked = rule.fields.includes(box.value);
    box.addEventListener('change', () => {
      rule.fields = [...row.querySelectorAll('.rule-fields input:checked')].map((b) => b.value);
      scheduleSave();
    });
  }

  row.querySelector('.rule-delete').addEventListener('click', () => {
    state.rules = state.rules.filter((r) => r !== rule);
    renderRules();
    scheduleSave();
  });
  return row;
}

function runTester() {
  const profile = { name: $('#t-name').value, bio: $('#t-bio').value, location: $('#t-location').value };
  const out = $('#t-result');
  if (!profile.name && !profile.bio && !profile.location) {
    out.textContent = 'Type a name, bio or location to see whether it would be hidden.';
    out.dataset.state = '';
    return;
  }
  const matches = evaluate(profile, state.rules);
  out.textContent = matches.length
    ? `Hidden by ${matches.map((m) => `${m.label} (${m.details.join(', ')})`).join(', ')}`
    : 'Not hidden';
  out.dataset.state = matches.length ? 'hidden' : 'shown';
}

function fill(settings) {
  state = settings;
  $('#enabled').checked = state.enabled;
  $('#skipFollowing').checked = state.skipFollowing;
  $('#allowlist').value = state.allowlist.map((h) => '@' + h).join('\n');
  renderRules();
  runTester();
}

$('#enabled').addEventListener('change', (e) => {
  state.enabled = e.target.checked;
  scheduleSave();
});
$('#skipFollowing').addEventListener('change', (e) => {
  state.skipFollowing = e.target.checked;
  scheduleSave();
});
$('#allowlist').addEventListener('input', scheduleSave);
for (const id of ['#t-name', '#t-bio', '#t-location']) $(id).addEventListener('input', runTester);

$('#add-rule').addEventListener('click', () => {
  state.rules.push(newRule());
  renderRules();
  $('#rules').lastElementChild.querySelector('.rule-name').focus();
  scheduleSave();
});

// The popup can edit settings while this page is open; reload anything that
// didn't come from this page's own saves.
onSettingsChanged((settings) => {
  if (JSON.stringify(settings) !== lastSaved) fill(settings);
});

loadSettings().then(fill);
