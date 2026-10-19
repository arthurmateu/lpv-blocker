// Runs in the page's own JS world (manifest "world": "MAIN") so it can see X's
// API traffic, and forwards API responses to the content script, which does
// all the parsing. The classic X app embeds each post author's full profile in
// timeline responses; the newer app only embeds names, so content.js falls back
// to looking profiles up.
(() => {
  const EVENT = 'lpvb:response';
  const API_RE = /^https:\/\/(?:api\.)?(?:x|twitter)\.com\/(?:i\/api\/)?(?:graphql|1\.1|2)\//;

  function forward(url, body) {
    const text = typeof body === 'string' ? body : '';
    // Synchronous across worlds, so profiles usually land before React renders
    // the posts. A string detail is the only payload both browsers pass cleanly.
    const detail = JSON.stringify({
      url: String(url).split('?')[0],
      size: text.length,
      body: text.includes('screen_name') ? text : '',
    });
    document.dispatchEvent(new CustomEvent(EVENT, { detail }));
  }

  const watched = new WeakSet();
  function watch(xhr) {
    if (watched.has(xhr)) return;
    watched.add(xhr);
    xhr.addEventListener('readystatechange', () => {
      if (xhr.readyState !== 4 || !API_RE.test(xhr.responseURL)) return;
      try {
        if (xhr.responseType === '' || xhr.responseType === 'text') forward(xhr.responseURL, xhr.responseText);
        else if (xhr.responseType === 'json') forward(xhr.responseURL, JSON.stringify(xhr.response));
      } catch {}
    });
  }

  // Hook both, in case the page wraps one of them after we load.
  const proto = XMLHttpRequest.prototype;
  for (const name of ['open', 'send']) {
    const original = proto[name];
    proto[name] = function () {
      try {
        watch(this);
      } catch {}
      return original.apply(this, arguments);
    };
  }

  const origFetch = window.fetch;
  window.fetch = function () {
    const promise = origFetch.apply(this, arguments);
    promise
      .then((res) => (API_RE.test(res.url) ? res.clone().text().then((text) => forward(res.url, text)) : null))
      .catch(() => {});
    return promise;
  };
})();
