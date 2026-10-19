// Collapses posts whose author matches a rule, leaving a bar that says why and
// lets you reveal the post. Profiles come from X's API traffic (via inject.js)
// and, when that lacks a bio, from fetching the author's profile page. Until
// either arrives, the display name shown in the post is checked on its own.
(() => {
  const { api, evaluate, loadSettings, onSettingsChanged, extractUsers, userKeySample, profilePageBlobs } = globalThis.LPVB;

  const HIDDEN_ATTR = 'data-lpvb-hidden';
  const STATUS_RE = /^\/(\w{1,15})\/status\/(\d+)/;
  // Posts are <article>s. A quoted post is usually its own <article> inside a
  // role="link" card; a quote inside a quote is only the card.
  const POST_SELECTOR = 'article, [role="link"][data-href*="/status/"]';
  const PROFILE_FIELDS = ['handle', 'name', 'bio', 'location', 'following'];
  const CACHE_KEY = 'profileCache';
  const CACHE_TTL = 3 * 24 * 60 * 60 * 1000;
  const CACHE_MAX = 3000;
  const LOOKUP_DELAY = 1500; // give API data a chance to arrive first
  const MAX_LOOKUPS = 2;

  const profiles = new Map(); // lowercase handle -> { handle, name, bio, location, following }
  const revealed = new Set(); // keys of posts the user chose to show this session
  let settings = null;
  let allow = new Set();
  let me = null;

  const debug = { responses: [], lookups: { done: 0, failed: 0, errors: [] }, userKeys: null, lookupUserKeys: null };

  function mergeUser(u) {
    if (!u || typeof u.handle !== 'string') return null;
    const key = u.handle.toLowerCase();
    const profile = profiles.get(key) || {};
    for (const field of PROFILE_FIELDS) {
      if (u[field] != null) profile[field] = u[field];
    }
    profiles.set(key, profile);
    return profile;
  }

  document.addEventListener('lpvb:response', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.detail);
    } catch {
      return;
    }
    let users = [];
    if (msg.body) {
      try {
        const json = JSON.parse(msg.body);
        users = extractUsers(json);
        if (!debug.userKeys && users.length) debug.userKeys = userKeySample(json);
      } catch {}
    }
    debug.responses.push(`${msg.url.replace(/^https:\/\/[^/]+/, '')} ${msg.size}B ${users.length} users`);
    if (debug.responses.length > 20) debug.responses.shift();
    if (/viewer/i.test(msg.url) && users.length === 1) me = users[0].handle.toLowerCase();
    if (!users.length) return;
    users.forEach(mergeUser);
    scanAll();
  });

  // ---- Profile lookups -----------------------------------------------------

  let cache = {};
  let cacheTimer = 0;

  async function loadCache() {
    try {
      cache = (await api.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
    } catch {}
    const now = Date.now();
    for (const [key, entry] of Object.entries(cache)) {
      if (now - entry.t > CACHE_TTL) delete cache[key];
      else mergeUser(entry);
    }
  }

  function remember(profile) {
    cache[profile.handle.toLowerCase()] = { ...profile, t: Date.now() };
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => {
      const entries = Object.entries(cache);
      if (entries.length > CACHE_MAX) {
        entries.sort((a, b) => b[1].t - a[1].t);
        cache = Object.fromEntries(entries.slice(0, CACHE_MAX));
      }
      api.storage.local.set({ [CACHE_KEY]: cache });
    }, 2000);
  }

  const queue = [];
  const requested = new Set();
  let running = 0;

  function requestLookup(handle) {
    const key = handle.toLowerCase();
    if (requested.has(key)) return;
    requested.add(key);
    setTimeout(() => {
      queue.push(handle);
      pump();
    }, LOOKUP_DELAY);
  }

  function pump() {
    while (running < MAX_LOOKUPS && queue.length) {
      const handle = queue.shift();
      if (!needsLookup(profiles.get(handle.toLowerCase()) || {}, true)) continue;
      running++;
      lookup(handle).finally(() => {
        running--;
        pump();
      });
    }
  }

  async function lookup(handle) {
    const key = handle.toLowerCase();
    try {
      const res = await fetch(`${location.origin}/${handle}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blobs = profilePageBlobs(await res.text());
      const users = blobs.flatMap(extractUsers);
      if (!users.some((u) => u.handle.toLowerCase() === key)) throw new Error(`no profile data (${blobs.length} blobs)`);
      users.forEach(mergeUser);
      const profile = profiles.get(key);
      profile.bio ??= '';
      profile.location ??= '';
      remember(profile);
      debug.lookups.done++;
      if (!debug.lookupUserKeys) debug.lookupUserKeys = blobs.map(userKeySample).find(Boolean) || null;
      scanAll();
    } catch (e) {
      debug.lookups.failed++;
      debug.lookups.errors.push(`@${handle}: ${e.message}`);
      if (debug.lookups.errors.length > 5) debug.lookups.errors.shift();
    }
  }

  // ---- Reading posts -------------------------------------------------------

  // X may render emoji as <img alt="🇺🇸">, so textContent alone could miss them.
  function readText(el) {
    let out = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
      else if (n.tagName === 'IMG') out += n.alt || '';
    }
    return out.trim();
  }

  function isPost(el) {
    return el.tagName === 'ARTICLE' || !el.querySelector('article');
  }

  function postsIn(root) {
    const found = root.matches?.(POST_SELECTOR) ? [root] : [];
    if (root.querySelectorAll) found.push(...root.querySelectorAll(POST_SELECTOR));
    return found.filter(isPost);
  }

  // Links belonging to this post rather than to a post quoted inside it.
  function ownLinks(post, selector) {
    return [...post.querySelectorAll(selector)].filter((a) => a.parentElement.closest('article, [role="link"]') === post);
  }

  // A post's own timestamp links to /<author>/status/<id>; a bare quote card
  // carries that path in data-href. Of the links to the author's profile, the
  // avatar reads as "@handle" or nothing and the handle as "@handle"; the
  // display name is the other one.
  function readAuthor(post) {
    const paths = post.tagName === 'ARTICLE'
      ? ownLinks(post, 'a[href*="/status/"]').map((a) => a.getAttribute('href'))
      : [post.getAttribute('data-href')];
    for (const path of paths) {
      const m = STATUS_RE.exec(path || '');
      if (!m) continue;
      const [, handle, id] = m;
      const profileHref = '/' + handle.toLowerCase();
      let name = null;
      for (const link of ownLinks(post, 'a[href^="/"]')) {
        if (link.getAttribute('href').toLowerCase() !== profileHref) continue;
        const text = readText(link);
        if (text && !text.startsWith('@')) {
          name = text;
          break;
        }
      }
      return { handle, name, key: `/${handle}/status/${id}`.toLowerCase() };
    }
    return null;
  }

  function ownHandle() {
    if (!me) {
      const href = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
      if (href) me = href.slice(1).toLowerCase();
    }
    return me;
  }

  function rulesNeedBio() {
    return settings.rules.some((r) => r.enabled && (r.fields.includes('bio') || r.fields.includes('location')));
  }

  // Name or bio unknown, or the post would be hidden but we don't yet know
  // whether you follow them.
  function needsLookup(profile, matched) {
    return (
      profile.name == null ||
      (profile.bio == null && rulesNeedBio()) ||
      (matched && settings.skipFollowing && profile.following == null)
    );
  }

  function processPost(post) {
    if (!settings) return;
    const author = readAuthor(post);
    if (!author) return;
    const key = author.handle.toLowerCase();
    let matches = [];
    if (settings.enabled && !allow.has(key) && key !== ownHandle()) {
      const profile = { handle: author.handle, name: author.name, ...profiles.get(key) };
      if (!(settings.skipFollowing && profile.following)) matches = evaluate(profile, settings.rules);
      if (needsLookup(profile, matches.length > 0)) requestLookup(author.handle);
    }
    render(post, author.key, author.handle, matches);
  }

  // ---- Collapsing posts ----------------------------------------------------

  // Bars sit just above their post rather than inside it, so a revealed post
  // shows below its bar whatever layout X uses inside the post. X can remove or
  // reorder posts under us, so each bar remembers its post and is swept away
  // once it's no longer right above it.
  const barPost = new WeakMap();
  const bars = new Set();

  function barFor(post) {
    const prev = post.previousElementSibling;
    return prev && barPost.get(prev) === post ? prev : null;
  }

  function sweepBars() {
    const stranded = [];
    for (const bar of bars) {
      const post = barPost.get(bar);
      if (bar.isConnected && post.previousElementSibling === bar) continue;
      bar.remove();
      bars.delete(bar);
      if (post.isConnected) stranded.push(post);
    }
    return stranded;
  }

  function render(post, key, handle, matches) {
    const sig = matches.length ? key + JSON.stringify(matches) : '';
    let bar = barFor(post);
    if ((post.dataset.lpvbSig || '') === sig && !!bar === !!sig) return;

    if (bar) {
      bar.remove();
      bars.delete(bar);
    }
    if (!sig) {
      delete post.dataset.lpvbSig;
      post.removeAttribute(HIDDEN_ATTR);
      return;
    }
    post.dataset.lpvbSig = sig;
    bar = buildBar(post, key, handle, matches);
    barPost.set(bar, post);
    bars.add(bar);
    post.before(bar);
    setHidden(post, bar, !revealed.has(key));
  }

  // "Post by @someone hidden by Annoying emojis"; hovering shows what matched.
  function buildBar(post, key, handle, matches) {
    const bar = document.createElement('div');
    bar.className = 'lpvb-bar';
    bar.dataset.label = `${post.parentElement?.closest('article') ? 'Quoted post' : 'Post'} by @${handle}`;
    bar.title = matches.map((m) => `${m.label}: ${m.details.join(', ')}`).join('\n');

    const text = document.createElement('div');
    text.className = 'lpvb-text';
    const title = document.createElement('span');
    title.className = 'lpvb-title';
    const rules = document.createElement('span');
    rules.className = 'lpvb-rules';
    rules.textContent = matches.map((m) => m.label).join(', ');
    text.append(title, ' ', rules);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lpvb-toggle';

    bar.append(text, button);
    bar.dataset.key = key;
    return bar;
  }

  function toggle(bar) {
    const post = barPost.get(bar);
    const hide = !post.hasAttribute(HIDDEN_ATTR);
    if (hide) revealed.delete(bar.dataset.key);
    else revealed.add(bar.dataset.key);
    setHidden(post, bar, hide);
  }

  // Bar clicks are handled on the window, before X sees them: X's quote cards
  // swallow clicks on their way down, so a listener on the bar itself would
  // never run, and X would otherwise open the post. Presses and keys inside a
  // bar are kept from X too (Enter/Space still activate the button).
  const ownBar = (e) => {
    const bar = e.target.closest?.('.lpvb-bar');
    return bar && bars.has(bar) ? bar : null;
  };
  window.addEventListener('click', (e) => {
    const bar = ownBar(e);
    if (!bar) return;
    e.preventDefault();
    e.stopPropagation();
    toggle(bar);
  }, true);
  for (const type of ['auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown']) {
    window.addEventListener(type, (e) => ownBar(e) && e.stopPropagation(), true);
  }

  function setHidden(post, bar, hidden) {
    post.toggleAttribute(HIDDEN_ATTR, hidden);
    bar.toggleAttribute('data-shown', !hidden);
    bar.querySelector('.lpvb-title').textContent = `${bar.dataset.label} ${hidden ? 'hidden' : '· hidden'} by`;
    bar.querySelector('.lpvb-toggle').textContent = hidden ? 'Show' : 'Hide';
  }

  function scanAll() {
    if (settings) postsIn(document).forEach(processPost);
  }

  function applySettings(next) {
    settings = next;
    allow = new Set(next.allowlist);
    scanAll();
  }

  Promise.all([loadSettings(), loadCache()]).then(([s]) => applySettings(s));
  onSettingsChanged(applySettings);

  new MutationObserver((records) => {
    if (!settings) return;
    const touched = new Set(sweepBars());
    const add = (root) => postsIn(root).forEach((p) => touched.add(p));
    for (const r of records) {
      const owner = r.target.closest?.('article');
      if (owner) add(owner);
      for (const n of r.addedNodes) {
        if (n.nodeType === Node.ELEMENT_NODE) add(n);
      }
    }
    touched.forEach(processPost);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---- Debug report (popup → "Copy debug report") -------------------------

  // Tag/attribute outline of a post, without its text, to see X's markup.
  function skeleton(el, depth = 0) {
    if (depth > 14) return '…';
    const attrs = ['data-testid', 'role', 'aria-label', 'href']
      .filter((a) => el.hasAttribute(a))
      .map((a) => `${a}="${el.getAttribute(a).slice(0, 60)}"`);
    const kids = [...el.children].filter((c) => !c.classList.contains('lpvb-bar')).map((c) => skeleton(c, depth + 1));
    return `<${el.tagName.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>${kids.join('')}`;
  }

  function buildReport() {
    const articles = postsIn(document);
    const authors = articles.map(readAuthor);
    const known = [...profiles.values()];
    const sample = articles.find((a, i) => authors[i]) || articles[0];
    return {
      version: api.runtime.getManifest().version,
      page: location.pathname,
      frontend: {
        newApp: document.documentElement.hasAttribute('data-app-env'),
        testidTweets: document.querySelectorAll('[data-testid="tweet"]').length,
      },
      settings: settings && {
        enabled: settings.enabled,
        skipFollowing: settings.skipFollowing,
        rules: settings.rules.filter((r) => r.enabled).map((r) => `${r.type} in ${r.fields.join('+')}`),
      },
      me: ownHandle(),
      articles: {
        total: articles.length,
        withAuthor: authors.filter(Boolean).length,
        hidden: document.querySelectorAll(`[${HIDDEN_ATTR}]`).length,
        authors: authors.filter(Boolean).slice(0, 6).map((a) => {
          const p = profiles.get(a.handle.toLowerCase()) || {};
          return `@${a.handle} name=${JSON.stringify(a.name)} bio=${p.bio == null ? '?' : 'yes'} following=${p.following ?? '?'}`;
        }),
      },
      profiles: {
        known: known.length,
        withBio: known.filter((p) => p.bio != null).length,
        withFollowing: known.filter((p) => p.following != null).length,
        following: known.filter((p) => p.following).length,
      },
      lookups: { ...debug.lookups, queued: queue.length, running, cached: Object.keys(cache).length },
      responses: debug.responses,
      userKeys: debug.userKeys,
      lookupUserKeys: debug.lookupUserKeys,
      sampleMarkup: sample ? skeleton(sample).slice(0, 3000) : null,
    };
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'lpvb:report') sendResponse(buildReport());
  });
})();
