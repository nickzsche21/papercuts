/* Cache-Control Simulator — 100% client-side. */
(function () {
  'use strict';
  const { $, esc, toast, copy, fmt } = window.PC;

  /* ---------------------------------------------------------------- parse */
  const BOOL_DIRECTIVES = ['no-store', 'no-cache', 'must-revalidate', 'proxy-revalidate',
    'private', 'public', 'immutable', 'no-transform', 'must-understand'];
  const NUM_DIRECTIVES = ['max-age', 's-maxage', 'stale-while-revalidate', 'stale-if-error',
    'max-stale', 'min-fresh'];

  function parseHeaders(text) {
    const h = Object.create(null);
    const raw = text.trim();
    if (!raw) return h;
    /* A bare directive list with no header name is treated as Cache-Control. */
    if (!/^[A-Za-z-]+\s*:/m.test(raw)) { h['cache-control'] = raw.replace(/\s+/g, ' ').trim(); return h; }
    raw.split(/\r?\n/).forEach(line => {
      const m = /^\s*([A-Za-z0-9-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) return;
      const k = m[1].toLowerCase(), v = m[2].trim();
      h[k] = h[k] ? h[k] + ', ' + v : v;
    });
    return h;
  }

  function parseCC(value) {
    const out = { present: [], unknown: [] };
    if (!value) return out;
    /* split on commas not inside quotes */
    const parts = []; let cur = '', q = false;
    for (const ch of value) {
      if (ch === '"') { q = !q; cur += ch; continue; }
      if (ch === ',' && !q) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    parts.map(s => s.trim()).filter(Boolean).forEach(p => {
      const m = /^([A-Za-z0-9-]+)(?:\s*=\s*(.*))?$/.exec(p);
      if (!m) { out.unknown.push(p); return; }
      const name = m[1].toLowerCase();
      let val = m[2];
      if (val !== undefined) val = val.replace(/^"|"$/g, '').trim();
      if (NUM_DIRECTIVES.indexOf(name) >= 0) {
        const n = parseInt(val, 10);
        out[name] = isNaN(n) ? 0 : n;
      } else if (BOOL_DIRECTIVES.indexOf(name) >= 0) {
        out[name] = true;
      } else { out.unknown.push(p); return; }
      out.present.push(name);
    });
    return out;
  }

  const dur = s => {
    if (s === null || s === undefined) return null;
    if (s === 0) return '0 seconds';
    const u = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'],
      [3600, 'hour'], [60, 'minute'], [1, 'second']];
    for (const [n, label] of u) {
      if (s >= n) { const v = Math.round((s / n) * 10) / 10; return v + ' ' + label + (v === 1 ? '' : 's'); }
    }
    return s + ' seconds';
  };

  /* ------------------------------------------------------------- analysis */
  function analyse(text) {
    const h = parseHeaders(text);
    const cc = parseCC(h['cache-control']);
    const hasValidator = !!(h['etag'] || h['last-modified']);
    const age = h['age'] ? parseInt(h['age'], 10) || 0 : null;

    /* freshness lifetime */
    let browserTTL = null, sharedTTL = null, ttlSource = null;
    if (cc['no-store']) { browserTTL = 0; sharedTTL = 0; ttlSource = 'no-store'; }
    else if (cc['max-age'] !== undefined) {
      browserTTL = cc['max-age']; sharedTTL = cc['max-age']; ttlSource = 'max-age';
      if (cc['s-maxage'] !== undefined) sharedTTL = cc['s-maxage'];
    } else if (cc['s-maxage'] !== undefined) {
      sharedTTL = cc['s-maxage']; ttlSource = 's-maxage';
      if (h['expires']) { browserTTL = expiresTTL(h); ttlSource = 's-maxage + Expires'; }
    } else if (h['expires']) {
      browserTTL = sharedTTL = expiresTTL(h); ttlSource = 'Expires';
    } else if (h['last-modified'] && !cc['no-cache']) {
      const lm = Date.parse(h['last-modified']);
      if (!isNaN(lm)) {
        browserTTL = sharedTTL = Math.max(0, Math.floor((Date.now() - lm) / 1000 * 0.1));
        ttlSource = 'heuristic';
      }
    }
    if (cc['private']) sharedTTL = 0;
    if (cc['no-cache']) { browserTTL = 0; sharedTTL = 0; ttlSource = ttlSource || 'no-cache'; }

    const swr = cc['stale-while-revalidate'];
    const sie = cc['stale-if-error'];

    return {
      headers: h, cc: cc, hasValidator: hasValidator, age: age,
      browserTTL: browserTTL, sharedTTL: sharedTTL, ttlSource: ttlSource,
      swr: swr, sie: sie,
      storable: !cc['no-store'],
      shareable: !cc['no-store'] && !cc['private'],
      warnings: warnings(h, cc, hasValidator, browserTTL, ttlSource, age),
      scenarios: scenarios(h, cc, hasValidator, browserTTL, sharedTTL, swr, sie)
    };
  }

  function expiresTTL(h) {
    const e = Date.parse(h['expires']);
    if (isNaN(e)) return 0;                       /* invalid Expires means already stale */
    const base = h['date'] ? Date.parse(h['date']) : Date.now();
    return Math.max(0, Math.floor((e - (isNaN(base) ? Date.now() : base)) / 1000));
  }

  /* ------------------------------------------------------------ scenarios */
  function scenarios(h, cc, hasValidator, bTTL, sTTL, swr, sie) {
    const S = [];
    const add = (name, kind, text) => S.push({ name: name, kind: kind, text: text });

    if (cc['no-store']) {
      add('First visit', 'net', 'Downloaded from the server.');
      add('Revisit', 'net', 'Downloaded again in full. Nothing is written to disk, so every visit costs a round trip.');
      add('Reload', 'net', 'Downloaded again.');
      add('Shared CDN cache', 'net', 'Never stored. Every user reaches your origin.');
      add('Back / forward', 'net', 'Refetched. no-store also disqualifies the page from the back-forward cache, so restoring it is slow.');
      return S;
    }

    add('First visit', 'net', 'Downloaded from the server and written to the cache.');

    if (bTTL === null) {
      add('Revisit', 'reval', 'No freshness information at all, so the browser has to ask the server every time. With no ETag or Last-Modified it cannot even get a 304 — it re-downloads the whole body.');
    } else if (bTTL === 0) {
      add('Revisit', 'reval', cc['no-cache']
        ? 'Served from cache only after the server confirms it is still valid. ' +
          (hasValidator ? 'With a validator present that confirmation is a cheap 304 with no body.'
                        : 'With no ETag or Last-Modified the server cannot answer 304, so the full body is downloaded every time — you get the round trip of no-store with none of the privacy.')
        : 'Immediately stale, so every reuse is revalidated with the server first.');
    } else {
      add('Revisit within ' + dur(bTTL), 'cache',
        'Served straight from disk with no network request at all. The server never hears about it, so it cannot invalidate this — the content is frozen for that long.');
      add('Revisit after ' + dur(bTTL), hasValidator ? 'reval' : 'net', hasValidator
        ? 'Conditional request with the validator. Unchanged content comes back as a 304 with no body.'
        : 'Full re-download. Without an ETag or Last-Modified there is nothing to revalidate against, so every expiry costs the entire file.');
    }

    if (swr !== undefined && bTTL) {
      add('Just after expiry (within ' + dur(swr) + ')', 'cache',
        'The stale copy is served instantly while a refresh happens in the background, so the user waits for nothing. This is usually the single best win available in these headers.');
    }
    if (sie !== undefined) {
      add('Origin is down', 'cache',
        'The stale copy keeps being served for up to ' + dur(sie) + ' instead of showing an error.');
    }

    add('Normal reload', 'reval',
      'Browsers attach max-age=0 to a reload, so it revalidates even when the copy is fresh. This is why reloading is a poor way to test caching.');
    add('Hard reload', 'net',
      'The cache is bypassed completely and everything is refetched. It tells you nothing about real visitors.');
    add('Back / forward', 'cache',
      'Usually restored instantly from the back-forward cache, which sits in front of these rules — even no-cache pages come back without a request.');

    if (cc['private']) {
      add('Shared CDN cache', 'net',
        'private forbids shared caches from storing this, so every request reaches your origin. Correct for user-specific responses, expensive for anything else.');
    } else if (sTTL === null) {
      add('Shared CDN cache', 'reval', 'No shared freshness lifetime, so the CDN revalidates against your origin.');
    } else if (sTTL === 0) {
      add('Shared CDN cache', 'reval', 'Stored but revalidated on every request.');
    } else {
      add('Shared CDN cache', 'cache',
        'Served from the edge for ' + dur(sTTL) + ' without touching your origin' +
        (cc['s-maxage'] !== undefined ? ' — s-maxage overrides max-age for shared caches only.' : '.'));
    }
    return S;
  }

  /* ------------------------------------------------------------- warnings */
  function warnings(h, cc, hasValidator, bTTL, ttlSource, age) {
    const W = [];
    const add = (sev, title, why) => W.push({ sev: sev, title: title, why: why });

    if (cc['no-store'] && (cc['max-age'] !== undefined || cc['public'] || cc['immutable'] || cc['s-maxage'] !== undefined))
      add('bad', 'no-store cancels the rest of this header',
        'Once no-store is present nothing may be stored, so max-age, public, s-maxage and immutable have no effect. Remove them, or remove no-store if you actually wanted caching.');

    /* Once no-store is present it dominates everything, so further complaints
       about no-cache interactions are noise rather than findings. */
    if (!cc['no-store'] && cc['no-cache'] && cc['max-age'] !== undefined)
      add('warn', 'no-cache overrides your max-age',
        'no-cache forces revalidation before every reuse, so the max-age you set never gets to keep anything fresh. If you wanted "cache for a while then check", drop no-cache and keep max-age.');

    if (!cc['no-store'] && cc['no-cache'] && !hasValidator)
      add('bad', 'no-cache with no ETag or Last-Modified',
        'Revalidation needs something to compare. With no validator the server cannot reply 304, so every single request re-downloads the whole body — the cost of no-store with none of its guarantees. Add an ETag.');

    if (cc['must-revalidate'] && cc['max-age'] === undefined && cc['s-maxage'] === undefined && !h['expires'])
      add('warn', 'must-revalidate has nothing to act on',
        'It only governs behaviour after a response goes stale, and nothing here defines staleness. It is not a way to force revalidation — that is no-cache.');

    if (cc['private'] && cc['s-maxage'] !== undefined)
      add('warn', 'private and s-maxage contradict each other',
        'private tells shared caches not to store the response; s-maxage tells them how long to keep it. Shared caches obey private, so s-maxage is dead weight.');

    if (cc['max-age'] !== undefined && h['expires'])
      add('info', 'Expires is being ignored',
        'When both are present max-age wins in every modern cache. The Expires header is only a fallback for HTTP/1.0 caches and can be dropped.');

    if (cc['immutable'] && cc['max-age'] !== undefined && cc['max-age'] < 86400)
      add('warn', 'immutable with a short max-age',
        'immutable promises the body will never change, which is only worth saying for content-hashed filenames cached for a long time. With ' +
        dur(cc['max-age']) + ' it buys almost nothing.');

    if (ttlSource === 'heuristic')
      add('bad', 'You are getting heuristic caching you did not ask for',
        'There is no Cache-Control and no Expires, but there is a Last-Modified, so caches invent a freshness lifetime — commonly a tenth of the age of the file. Roughly ' +
        dur(bTTL) + ' here. Set an explicit Cache-Control to stop guessing.');

    if (bTTL === null && ttlSource === null && !cc['no-store'] && !cc['no-cache'])
      add('bad', 'No caching instructions at all',
        'Nothing here tells a cache what to do, so behaviour varies by browser, by CDN and by proxy. Always state your intent explicitly.');

    if (cc['public'] && h['authorization'])
      add('warn', 'public on a response to an authorised request',
        'public makes an authenticated response storable by shared caches. Unless you are certain the body is identical for every user, this leaks one user’s data to another.');

    if (!h['vary'] && (h['content-encoding'] || h['content-language']))
      add('warn', 'Content negotiation without a Vary header',
        'The response varies by request headers but does not say so, so a cache can serve the wrong encoding or language to the next visitor. Add Vary.');

    if (h['vary'] && /^\s*\*\s*$/.test(h['vary']))
      add('bad', 'Vary: * makes the response uncacheable',
        'It tells every cache that the response depends on something it cannot see, so nothing is ever reused.');

    if (age !== null && bTTL !== null && age > bTTL)
      add('warn', 'This response is already stale',
        'The Age header says it has been in a cache for ' + dur(age) + ', which is longer than its ' +
        dur(bTTL) + ' lifetime. The next client will have to revalidate immediately.');

    if (h['pragma'] && /no-cache/i.test(h['pragma']))
      add('info', 'Pragma: no-cache does nothing here',
        'Pragma is an HTTP/1.0 request header. On a response modern caches ignore it entirely — Cache-Control is what matters.');

    if (cc.unknown && cc.unknown.length)
      add('warn', 'Unrecognised directive: ' + cc.unknown.join(', '),
        'Caches ignore directives they do not understand, so a typo like "max_age" or "maxage" silently disables the caching you intended.');

    if (cc['max-age'] !== undefined && cc['max-age'] > 31536000)
      add('info', 'max-age above one year',
        'One year is the practical maximum that caches honour. Larger values are clamped.');

    return W;
  }

  /* ------------------------------------------------------------- presets */
  const PRESETS = [
    ['Hashed asset (JS/CSS with a content hash)',
      'Cache-Control: public, max-age=31536000, immutable'],
    ['HTML that must always be current',
      'Cache-Control: no-cache\nETag: "v7-a1b2c3"'],
    ['API JSON, short cache, instant staleness',
      'Cache-Control: public, max-age=60, stale-while-revalidate=300, stale-if-error=86400\nETag: "d4e5f6"'],
    ['User-specific page',
      'Cache-Control: private, no-cache\nETag: "u42-991"\nVary: Cookie'],
    ['Sensitive — never store',
      'Cache-Control: no-store'],
    ['CDN long, browser short',
      'Cache-Control: public, max-age=60, s-maxage=86400\nETag: "abc123"\nVary: Accept-Encoding'],
    ['The accidental default (no headers)',
      'Last-Modified: Wed, 01 Jan 2025 10:00:00 GMT'],
    ['Contradictory mess',
      'Cache-Control: no-store, no-cache, max-age=3600, private, s-maxage=600, must-revalidate']
  ];

  window.PapercutsCache = { parseHeaders, parseCC, analyse, dur, PRESETS };

  /* -------------------------------------------------------------- render */
  if (!document.getElementById('input')) return;

  const statusEl = $('#status'), outEl = $('#out');

  $('#presets').innerHTML = PRESETS.map((p, i) =>
    '<button data-preset="' + i + '">' + esc(p[0]) + '</button>').join('');
  Array.from(document.querySelectorAll('[data-preset]')).forEach(b => {
    b.onclick = () => { $('#input').value = PRESETS[+b.dataset.preset][1]; run(); };
  });

  const KIND = { net: ['d-net', 'network'], cache: ['d-cache', 'from cache'], reval: ['d-reval', 'revalidate'] };
  const SEV = { bad: 'bad', warn: 'warn', info: 'neutral' };

  function run() {
    const text = $('#input').value;
    if (!text.trim()) {
      statusEl.innerHTML = '<section><div class="err">Paste some headers, or pick one of the presets.</div></section>';
      outEl.hidden = true; return;
    }
    const a = analyse(text);
    if (!a.headers['cache-control'] && !a.headers['expires'] && !a.headers['last-modified'] && !a.headers['etag']) {
      statusEl.innerHTML = '<section><div class="err">No caching headers found in that. ' +
        'Paste a <code>Cache-Control</code> line (or just its value), optionally with ' +
        '<code>ETag</code>, <code>Expires</code>, <code>Last-Modified</code>, <code>Age</code> or <code>Vary</code>.</div></section>';
      outEl.hidden = true; return;
    }
    statusEl.innerHTML = '';
    render(a);
  }

  function verdict(a) {
    if (!a.storable) return 'Never stored anywhere. Every request goes to your origin.';
    const b = a.browserTTL, s = a.sharedTTL;
    const parts = [];
    if (b === null) parts.push('the browser has no freshness rule and must revalidate');
    else if (b === 0) parts.push('the browser revalidates before every reuse');
    else parts.push('the browser reuses it for ' + dur(b) + ' without asking');
    if (!a.shareable) parts.push('shared caches must not store it');
    else if (s === null) parts.push('a CDN must revalidate');
    else if (s === 0) parts.push('a CDN revalidates every time');
    else parts.push('a CDN serves it for ' + dur(s));
    return parts.join(', and ') + '.';
  }

  function render(a) {
    const H = [];
    const bad = a.warnings.filter(w => w.sev === 'bad').length;
    const warn = a.warnings.filter(w => w.sev === 'warn').length;

    H.push('<section><div class="card pad" style="border-color:var(--' +
      (bad ? 'bad' : warn ? 'warn' : 'ok') + ')">');
    H.push('<h2 style="margin:0 0 5px;font-size:19px">' + esc(verdict(a)) + '</h2>');
    H.push('<div class="muted">' +
      (a.ttlSource ? 'Freshness comes from <code>' + esc(a.ttlSource) + '</code>' : 'No freshness source') +
      ' &middot; ' + (a.hasValidator ? 'validator present' : '<strong>no ETag or Last-Modified</strong>') +
      ' &middot; ' + (a.shareable ? 'shared caches allowed' : 'browser only') + '</div>');
    H.push('</div></section>');

    /* directives seen */
    if (a.cc.present.length || (a.cc.unknown || []).length) {
      H.push('<section><label>Directives read</label><div class="dirlist" style="margin-top:7px">');
      a.cc.present.forEach(d => {
        const v = a.cc[d];
        const dead = (a.cc['no-store'] && d !== 'no-store') ||
          (a.cc['private'] && d === 's-maxage') ||
          (a.cc['no-cache'] && d === 'max-age');
        H.push('<span class="dir' + (dead ? ' off' : '') + '">' + esc(d) +
          (v === true ? '' : '=' + v) + '</span>');
      });
      (a.cc.unknown || []).forEach(u =>
        H.push('<span class="dir off" title="not a recognised directive">' + esc(u) + '</span>'));
      H.push('</div><p class="muted" style="margin:7px 0 0">Struck-through directives have no effect given the others.</p></section>');
    }

    /* timeline */
    if (a.storable && a.browserTTL) {
      const fresh = a.browserTTL, sw = a.swr || 0;
      const total = fresh + sw + Math.max(fresh * 0.5, 1);
      const pct = n => Math.max(6, Math.round(n / total * 100));
      H.push('<section><label>Browser timeline after the first download</label><div class="timeline" style="margin-top:7px">');
      H.push('<i class="tl-fresh" style="width:' + pct(fresh) + '%">fresh &middot; ' + esc(dur(fresh)) + '</i>');
      if (sw) H.push('<i class="tl-swr" style="width:' + pct(sw) + '%">stale served, refreshed behind you &middot; ' + esc(dur(sw)) + '</i>');
      H.push('<i class="tl-stale" style="flex:1">then revalidate</i>');
      H.push('</div></section>');
    }

    /* scenarios */
    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">What actually happens</h2>');
    H.push('<div class="tablewrap"><table class="scn"><thead><tr><th>Situation</th><th>Result</th><th>Detail</th></tr></thead><tbody>');
    a.scenarios.forEach(s => {
      const k = KIND[s.kind];
      H.push('<tr><td>' + esc(s.name) + '</td><td style="white-space:nowrap"><span class="dot2 ' + k[0] + '"></span>' +
        k[1] + '</td><td class="muted">' + esc(s.text) + '</td></tr>');
    });
    H.push('</tbody></table></div></section>');

    /* warnings */
    if (a.warnings.length) {
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Problems in these headers</h2>');
      a.warnings.forEach(w => {
        H.push('<div class="card pad" style="margin-bottom:8px"><span class="badge ' + SEV[w.sev] + '">' +
          (w.sev === 'bad' ? 'breaks' : w.sev === 'warn' ? 'watch' : 'note') + '</span> ' +
          '<strong style="margin-left:6px">' + esc(w.title) + '</strong>' +
          '<div class="muted" style="margin-top:5px">' + esc(w.why) + '</div></div>');
      });
      H.push('</section>');
    } else {
      H.push('<section><div class="note">No contradictions found. Every directive here is doing something.</div></section>');
    }

    H.push('<section><div class="row"><button class="primary" id="cp">Copy the summary</button>' +
      '<button id="reset">Try other headers</button></div></section>');

    outEl.innerHTML = H.join('');
    outEl.hidden = false;
    $('#cp').onclick = () => copy(report(a), 'Summary copied');
    $('#reset').onclick = () => {
      outEl.hidden = true; outEl.innerHTML = ''; $('#input').value = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function report(a) {
    const L = ['Cache-Control analysis', '', verdict(a), ''];
    L.push('What happens:');
    a.scenarios.forEach(s => L.push('  ' + s.name + ' -> ' + KIND[s.kind][1] + '. ' + s.text));
    if (a.warnings.length) {
      L.push('', 'Problems:');
      a.warnings.forEach(w => L.push('  [' + w.sev.toUpperCase() + '] ' + w.title + ' — ' + w.why));
    }
    L.push('', 'Checked with https://papercuts-mauve.vercel.app/cache-control');
    return L.join('\n');
  }

  $('#run').onclick = run;
  $('#clear').onclick = () => {
    $('#input').value = ''; outEl.hidden = true; outEl.innerHTML = '';
    statusEl.innerHTML = ''; $('#input').focus();
  };
  $('#input').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });
})();
