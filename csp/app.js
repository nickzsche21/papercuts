/* CSP Violation Decoder — 100% client-side. */
(function () {
  'use strict';
  const { $, esc, toast, copy, fmt } = window.PC;

  /* Directive knowledge. fallback: what it inherits from when unset. */
  const DIRECTIVES = {
    'script-src':      { what: 'JavaScript: <script> tags, workers and eval', fallback: 'default-src', critical: true },
    'script-src-elem': { what: '<script> elements specifically', fallback: 'script-src', critical: true },
    'script-src-attr': { what: 'inline event handlers such as onclick', fallback: 'script-src', critical: true },
    'style-src':       { what: 'stylesheets and inline styles', fallback: 'default-src' },
    'style-src-elem':  { what: '<link rel=stylesheet> and <style> elements', fallback: 'style-src' },
    'style-src-attr':  { what: 'inline style="" attributes', fallback: 'style-src' },
    'img-src':         { what: 'images and favicons', fallback: 'default-src' },
    'font-src':        { what: 'web fonts', fallback: 'default-src' },
    'connect-src':     { what: 'fetch, XHR, WebSocket, EventSource and beacons', fallback: 'default-src' },
    'media-src':       { what: 'audio and video', fallback: 'default-src' },
    'object-src':      { what: 'plugins: <object>, <embed>, <applet>', fallback: 'default-src', critical: true },
    'frame-src':       { what: 'nested browsing contexts: <iframe>', fallback: 'child-src' },
    'child-src':       { what: 'workers and nested contexts (legacy)', fallback: 'default-src' },
    'worker-src':      { what: 'Worker, SharedWorker and ServiceWorker scripts', fallback: 'child-src' },
    'manifest-src':    { what: 'the web app manifest', fallback: 'default-src' },
    'form-action':     { what: 'where a <form> may submit', fallback: null, critical: true },
    'frame-ancestors': { what: 'who may frame this page (clickjacking)', fallback: null, critical: true },
    'base-uri':        { what: 'what a <base> tag may set', fallback: null, critical: true },
    'default-src':     { what: 'the fallback for most fetch directives', fallback: null }
  };

  /* Violation shapes. Each maps a console line to a directive and a fix kind. */
  const PATTERNS = [
    { re: /Refused to execute inline script/i,               dir: 'script-src', kind: 'inline-script' },
    { re: /Refused to execute inline event handler/i,         dir: 'script-src-attr', kind: 'inline-handler' },
    { re: /Refused to evaluate a string as JavaScript/i,      dir: 'script-src', kind: 'eval' },
    { re: /Refused to load the script ['"]([^'"]+)['"]/i,     dir: 'script-src', kind: 'url' },
    { re: /Refused to apply inline style/i,                   dir: 'style-src', kind: 'inline-style' },
    { re: /Refused to load the stylesheet ['"]([^'"]+)['"]/i, dir: 'style-src', kind: 'url' },
    { re: /Refused to load the image ['"]([^'"]+)['"]/i,      dir: 'img-src', kind: 'url' },
    { re: /Refused to load the font ['"]([^'"]+)['"]/i,       dir: 'font-src', kind: 'url' },
    { re: /Refused to load media from ['"]([^'"]+)['"]/i,     dir: 'media-src', kind: 'url' },
    { re: /Refused to load manifest from ['"]([^'"]+)['"]/i,  dir: 'manifest-src', kind: 'url' },
    { re: /Refused to connect to ['"]([^'"]+)['"]/i,          dir: 'connect-src', kind: 'url' },
    { re: /Refused to frame ['"]([^'"]+)['"]/i,               dir: 'frame-src', kind: 'url' },
    { re: /Refused to create a worker from ['"]([^'"]+)['"]/i, dir: 'worker-src', kind: 'url' },
    { re: /Refused to send form data to ['"]([^'"]+)['"]/i,   dir: 'form-action', kind: 'url' },
    { re: /Refused to load ['"]([^'"]+)['"]/i,                dir: 'default-src', kind: 'url' }
  ];

  /* Reduce a blocked URL to the source expression to allowlist. */
  function sourceFor(url) {
    if (!url) return null;
    if (/^data:/i.test(url)) return 'data:';
    if (/^blob:/i.test(url)) return 'blob:';
    if (/^filesystem:/i.test(url)) return 'filesystem:';
    if (/^wss?:/i.test(url)) { try { return new URL(url).origin.replace(/^http/, 'ws'); } catch (e) { return null; } }
    try {
      const u = new URL(url);
      return u.origin;
    } catch (e) { return null; }
  }

  function parseViolations(text) {
    const out = [];
    text.split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const reportOnly = /\[Report Only\]/i.test(line);
      /* The directive the browser actually enforced, quoted in the message. */
      /* The quoted policy fragment itself contains single quotes ('self', 'none'),
         so it must be matched on the double quotes browsers wrap it in. */
      const eff = /Content Security Policy directive:\s*"([^"]+)"/i.exec(line)
        || /Content Security Policy directive:\s*'([^']*(?:'[a-z-]+'[^']*)*)'/i.exec(line);
      let effDir = null, effValue = null;
      if (eff) {
        const bits = eff[1].trim().split(/\s+/);
        effDir = bits[0];
        effValue = bits.slice(1).join(' ');
      }
      for (const p of PATTERNS) {
        const m = p.re.exec(line);
        if (!m) continue;
        const url = p.kind === 'url' ? m[1] : null;
        out.push({
          line: i + 1, raw: line, kind: p.kind,
          directive: effDir || p.dir,
          reportedDirective: p.dir,
          currentValue: effValue,
          url: url, source: sourceFor(url), reportOnly: reportOnly
        });
        return;
      }
    });
    return out;
  }

  /* ------------------------------------------------------------ policy IO */
  function parsePolicy(text) {
    const p = {};
    (text || '').split(';').forEach(chunk => {
      const bits = chunk.trim().split(/\s+/).filter(Boolean);
      if (!bits.length) return;
      p[bits[0].toLowerCase()] = bits.slice(1);
    });
    return p;
  }

  const serialize = p => Object.keys(p)
    .map(k => (p[k].length ? k + ' ' + p[k].join(' ') : k)).join('; ');

  /* Build the policy that unblocks everything, given a strategy for inline. */
  function buildPolicy(current, violations, opts) {
    const p = {};
    Object.keys(current).forEach(k => { p[k] = current[k].slice(); });
    if (!Object.keys(p).length) { p['default-src'] = ["'self'"]; }

    const add = (dir, val) => {
      if (!p[dir]) {
        const base = DIRECTIVES[dir] && DIRECTIVES[dir].fallback;
        p[dir] = (base && p[base]) ? p[base].slice() : ["'self'"];
      }
      if (p[dir].indexOf(val) < 0 && val) p[dir].push(val);
      p[dir] = p[dir].filter(v => v !== "'none'");
    };

    violations.forEach(v => {
      const d = v.directive;
      if (v.kind === 'url' && v.source) add(d, v.source);
      else if (v.kind === 'inline-script' || v.kind === 'inline-handler') {
        add(v.kind === 'inline-handler' ? 'script-src-attr' : 'script-src',
          opts.inline === 'nonce' ? "'nonce-{RANDOM_PER_REQUEST}'"
            : opts.inline === 'hash' ? "'sha256-{BASE64_OF_SCRIPT_BODY}'"
            : "'unsafe-inline'");
      } else if (v.kind === 'inline-style') {
        add('style-src', opts.inline === 'nonce' ? "'nonce-{RANDOM_PER_REQUEST}'" : "'unsafe-inline'");
      } else if (v.kind === 'eval') add('script-src', "'unsafe-eval'");
    });

    /* Hardening that costs nothing and is never inherited from default-src. */
    if (opts.harden) {
      if (!p['object-src']) p['object-src'] = ["'none'"];
      if (!p['base-uri']) p['base-uri'] = ["'self'"];
      if (!p['frame-ancestors']) p['frame-ancestors'] = ["'none'"];
    }
    return p;
  }

  /* ----------------------------------------------------------------- grade */
  function grade(p) {
    const issues = [];
    const s = d => (p[d] || []).join(' ');
    const script = p['script-src'] || p['default-src'] || [];
    const hasNonceOrHash = script.some(v => /^'(nonce-|sha(256|384|512)-)/.test(v));

    if (script.indexOf("'unsafe-inline'") >= 0 && !hasNonceOrHash)
      issues.push(['bad', "script-src allows 'unsafe-inline'",
        'Any injected <script> tag executes. This is the single concession that makes a CSP decorative rather than protective.']);
    if (script.indexOf("'unsafe-inline'") >= 0 && hasNonceOrHash)
      issues.push(['info', "script-src has both 'unsafe-inline' and a nonce or hash",
        "Modern browsers ignore 'unsafe-inline' when a nonce or hash is present, so this is a safe fallback for very old browsers, not a hole."]);
    if (script.indexOf("'unsafe-eval'") >= 0)
      issues.push(['warn', "script-src allows 'unsafe-eval'",
        'eval, new Function and string setTimeout stay available to injected code. Usually a bundler or template engine needs this — check whether a production build still does.']);
    if (script.indexOf('*') >= 0)
      issues.push(['bad', 'script-src allows any host',
        'A wildcard host list means any origin on the internet can serve script to your page.']);
    if (script.some(v => /^(https?:|data:)$/.test(v)))
      issues.push(['bad', 'script-src allows a whole scheme',
        'data: in script-src is directly exploitable; a bare https: allows every HTTPS host there is.']);
    if (!p['object-src'] && !(p['default-src'] || []).includes("'none'"))
      issues.push(['warn', "object-src is not set to 'none'",
        'Legacy plugin content can bypass script restrictions. There is no cost to setting it.']);
    if (!p['base-uri'])
      issues.push(['warn', 'base-uri is not set',
        'It never falls back to default-src. Without it, an injected <base> tag can repoint every relative script URL on the page.']);
    if (!p['frame-ancestors'])
      issues.push(['warn', 'frame-ancestors is not set',
        'It never falls back to default-src. Without it the page can be framed by anyone, which is the clickjacking case X-Frame-Options used to cover.']);
    if (!p['default-src'])
      issues.push(['info', 'No default-src',
        'Directives you have not listed are unrestricted. Setting default-src \'self\' gives everything a floor.']);

    const score = Math.max(0, 100
      - issues.filter(i => i[0] === 'bad').length * 34
      - issues.filter(i => i[0] === 'warn').length * 11);
    const letter = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 35 ? 'D' : 'F';
    return { issues: issues, score: score, letter: letter };
  }

  /* ------------------------------------------------------------ deployment */
  const STACKS = ['Header', 'nginx', 'Apache', 'Express', 'Next.js', '<meta> tag'];

  function deploy(stack, policy, reportOnly) {
    const name = reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
    switch (stack) {
      case 'Header':
        return name + ': ' + policy;
      case 'nginx':
        return 'add_header ' + name + ' "' + policy.replace(/"/g, '\\"') + '" always;';
      case 'Apache':
        return 'Header always set ' + name + ' "' + policy.replace(/"/g, '\\"') + '"';
      case 'Express':
        return "app.use((req, res, next) => {\n" +
          "  res.setHeader(\n    '" + name + "',\n    \"" + policy.replace(/"/g, '\\"') + "\"\n  );\n" +
          "  next();\n});";
      case 'Next.js':
        return '// next.config.js\nmodule.exports = {\n  async headers() {\n    return [{\n' +
          "      source: '/:path*',\n      headers: [{\n" +
          "        key: '" + name + "',\n        value: \"" + policy.replace(/"/g, '\\"') + "\",\n" +
          '      }],\n    }];\n  },\n};';
      case '<meta> tag':
        return '<meta http-equiv="' + name + '"\n      content="' + policy.replace(/"/g, '&quot;') + '">\n\n' +
          '<!-- A meta tag cannot express frame-ancestors, report-uri or sandbox.\n' +
          '     Prefer a real response header wherever you can set one. -->';
    }
    return '';
  }

  window.PapercutsCSP = { parseViolations, parsePolicy, buildPolicy, serialize,
    grade, deploy, sourceFor, DIRECTIVES, STACKS };

  /* ---------------------------------------------------------------- render */
  if (!document.getElementById('input')) return;

  const statusEl = $('#status'), outEl = $('#out');
  let state = { stack: 'Header', inline: 'nonce', harden: true, reportOnly: false };

  const SAMPLES = [
    ['Third-party script blocked',
     "Refused to load the script 'https://cdn.jsdelivr.net/npm/chart.js' because it violates the following Content Security Policy directive: \"script-src 'self'\".",
     "default-src 'self'; script-src 'self'"],
    ['Inline script + Google Fonts',
     "Refused to execute inline script because it violates the following Content Security Policy directive: \"script-src 'self'\". Either the 'unsafe-inline' keyword, a hash ('sha256-abc123'), or a nonce ('nonce-...') is required to enable inline execution.\nRefused to load the stylesheet 'https://fonts.googleapis.com/css2?family=Inter' because it violates the following Content Security Policy directive: \"style-src 'self'\".\nRefused to load the font 'https://fonts.gstatic.com/s/inter/v12/a.woff2' because it violates the following Content Security Policy directive: \"font-src 'self'\".",
     "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'"],
    ['API + analytics + iframe',
     "Refused to connect to 'https://api.example.com/v1/events' because it violates the following Content Security Policy directive: \"connect-src 'self'\".\nRefused to load the script 'https://www.googletagmanager.com/gtag/js' because it violates the following Content Security Policy directive: \"script-src 'self'\".\nRefused to frame 'https://www.youtube.com/embed/abc' because it violates the following Content Security Policy directive: \"frame-src 'none'\".",
     "default-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'none'"],
    ['eval and inline handlers',
     "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: \"script-src 'self'\".\nRefused to execute inline event handler because it violates the following Content Security Policy directive: \"script-src 'self'\".",
     "default-src 'self'; script-src 'self'"],
    ['Report-only run',
     "[Report Only] Refused to load the image 'https://images.unsplash.com/photo-1.jpg' because it violates the following Content Security Policy directive: \"img-src 'self' data:\".",
     "default-src 'self'; img-src 'self' data:"]
  ];

  $('#samples').innerHTML = SAMPLES.map((s, i) =>
    '<button class="stackbtn" data-sample="' + i + '">' + esc(s[0]) + '</button>').join('');
  Array.from(document.querySelectorAll('[data-sample]')).forEach(b => {
    b.onclick = () => {
      const s = SAMPLES[+b.dataset.sample];
      $('#input').value = s[1]; $('#policy').value = s[2]; run();
    };
  });

  function run() {
    const text = $('#input').value.trim();
    if (!text) {
      statusEl.innerHTML = '<section><div class="err">Paste at least one violation, or pick a sample.</div></section>';
      outEl.hidden = true; return;
    }
    const violations = parseViolations(text);
    if (!violations.length) {
      statusEl.innerHTML = '<section><div class="err">No CSP violations recognised. ' +
        'The console lines normally start with &ldquo;Refused to&hellip;&rdquo; and quote a directive. ' +
        'Copy whole lines from the console, including the quoted policy at the end.</div></section>';
      outEl.hidden = true; return;
    }
    statusEl.innerHTML = '';
    state.violations = violations;
    state.current = parsePolicy($('#policy').value);
    render();
  }

  const KINDLABEL = {
    'inline-script': 'inline <script> block',
    'inline-handler': 'inline event handler (onclick=…)',
    'inline-style': 'inline style',
    'eval': 'eval / new Function',
    'url': 'external resource'
  };

  function render() {
    const V = state.violations;
    const built = buildPolicy(state.current, V, { inline: state.inline, harden: state.harden });
    const policyStr = serialize(built);
    const g = grade(built);
    const before = Object.keys(state.current).length ? grade(state.current) : null;
    const needsInline = V.some(v => /inline|eval/.test(v.kind));
    const H = [];

    /* summary */
    const groups = {};
    V.forEach(v => { (groups[v.directive] = groups[v.directive] || []).push(v); });
    const reportOnlyAll = V.every(v => v.reportOnly);

    H.push('<section><div class="card pad" style="border-color:var(--bad)">');
    H.push('<h2 style="margin:0;font-size:19px">' + fmt(V.length) + ' violation' +
      (V.length === 1 ? '' : 's') + ' across ' + Object.keys(groups).length + ' directive' +
      (Object.keys(groups).length === 1 ? '' : 's') + '</h2>');
    H.push('<div class="muted" style="margin-top:4px">' +
      (reportOnlyAll
        ? 'All report-only — nothing is actually broken for users yet. This is the right time to fix it.'
        : 'These resources are being blocked right now.') + '</div>');
    H.push('</div></section>');

    /* what is blocked */
    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">What is blocked</h2>');
    H.push('<div class="tablewrap"><table><thead><tr><th>Directive</th><th>What</th>' +
      '<th>Blocked</th><th>Add to the policy</th></tr></thead><tbody>');
    V.forEach(v => {
      const meta = DIRECTIVES[v.directive] || {};
      H.push('<tr><td><code>' + esc(v.directive) + '</code>' +
        (v.reportOnly ? ' <span class="badge neutral">report only</span>' : '') +
        '<div class="muted" style="font-size:12px;margin-top:3px">' + esc(meta.what || '') + '</div></td>');
      H.push('<td>' + esc(KINDLABEL[v.kind] || v.kind) + '</td>');
      H.push('<td class="mono" style="word-break:break-all">' +
        esc(v.url ? v.url.slice(0, 70) + (v.url.length > 70 ? '…' : '') : '—') + '</td>');
      H.push('<td class="mono" style="color:var(--ok)">' + esc(
        v.kind === 'url' ? (v.source || 'could not derive a source')
          : v.kind === 'eval' ? "'unsafe-eval'"
          : state.inline === 'nonce' ? "'nonce-…'"
          : state.inline === 'hash' ? "'sha256-…'" : "'unsafe-inline'") + '</td></tr>');
    });
    H.push('</tbody></table></div></section>');

    /* inline strategy */
    if (needsInline) {
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">How to allow the inline code</h2>');
      const opt = (key, cls, title, body) =>
        '<label class="fixopt ' + cls + '" style="display:block;cursor:pointer">' +
        '<h4><input type="radio" name="inline" value="' + key + '"' +
        (state.inline === key ? ' checked' : '') + ' style="accent-color:var(--accent)"> ' + title + '</h4>' +
        '<div class="muted" style="font-size:13px">' + body + '</div></label>';
      H.push(opt('nonce', 'best', 'Nonce &nbsp;<span class="badge ok">recommended</span>',
        'Generate a fresh random value per request, put it in the header and on the tag as ' +
        '<code>&lt;script nonce="…"&gt;</code>. Injected script has no way to guess it. ' +
        'The nonce must be different on every response — a hardcoded one is worth nothing.'));
      H.push(opt('hash', '', 'Hash',
        'Take the SHA-256 of the exact script body and list it. No server-side templating needed, ' +
        'which makes it the right choice for a static site — but the hash changes whenever the script does. ' +
        'The browser prints the expected hash in the console error.'));
      H.push(opt('unsafe', 'worst', "'unsafe-inline' &nbsp;<span class=\"badge bad\">last resort</span>",
        'Allows every inline script on the page, including any an attacker manages to inject. ' +
        'This removes the protection CSP was added for. Use it only as a temporary step, and only ' +
        'where the alternative is turning CSP off entirely.'));
      H.push('</section>');
    }

    /* policy */
    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Your policy, fixed</h2>');
    H.push('<div class="row" style="margin-bottom:10px">');
    H.push('<label class="opt" style="display:flex;gap:7px;align-items:center;font-size:13.5px;cursor:pointer">' +
      '<input type="checkbox" id="harden"' + (state.harden ? ' checked' : '') +
      ' style="accent-color:var(--accent)"> Add the free hardening (<code>object-src</code>, <code>base-uri</code>, <code>frame-ancestors</code>)</label>');
    H.push('<label class="opt" style="display:flex;gap:7px;align-items:center;font-size:13.5px;cursor:pointer">' +
      '<input type="checkbox" id="ro"' + (state.reportOnly ? ' checked' : '') +
      ' style="accent-color:var(--accent)"> Report-only (test without breaking anything)</label>');
    H.push('</div>');
    H.push('<div class="stacks" style="margin-bottom:11px">' + STACKS.map(s =>
      '<button class="stackbtn' + (s === state.stack ? ' on' : '') + '" data-stack="' + esc(s) + '">' +
      esc(s) + '</button>').join('') + '</div>');
    H.push('<pre class="code">' + esc(deploy(state.stack, policyStr, state.reportOnly)) + '</pre>');
    H.push('<div class="row" style="margin-top:9px"><button class="primary" id="cp">Copy</button>' +
      '<button id="cp-report">Copy the whole diagnosis</button></div>');
    if (state.inline === 'nonce' && needsInline)
      H.push('<p class="muted" style="margin:9px 0 0">Replace <code>{RANDOM_PER_REQUEST}</code> with a fresh base64 value generated per response, and put the same value in the <code>nonce</code> attribute of each inline tag.</p>');
    if (state.inline === 'hash' && needsInline)
      H.push('<p class="muted" style="margin:9px 0 0">Replace <code>{BASE64_OF_SCRIPT_BODY}</code> with the hash from the console message — Chrome prints the exact value it expected.</p>');
    H.push('</section>');

    /* grade */
    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">How strong is the result?</h2>');
    H.push('<div class="card pad"><div class="grade"><b style="color:var(--' +
      (g.score >= 75 ? 'ok' : g.score >= 45 ? 'warn' : 'bad') + ')">' + g.letter + '</b>' +
      '<div><div style="font-weight:600">' + g.score + ' / 100</div>' +
      (before ? '<div class="muted" style="font-size:13px">Your current policy scores ' +
        before.score + ' (' + before.letter + ')</div>' : '') + '</div></div>');
    if (g.issues.length) {
      H.push('<div style="margin-top:13px">');
      g.issues.forEach(i => {
        H.push('<div style="margin-bottom:9px"><span class="badge ' +
          (i[0] === 'bad' ? 'bad' : i[0] === 'warn' ? 'warn' : 'neutral') + '">' +
          (i[0] === 'bad' ? 'weak' : i[0] === 'warn' ? 'missing' : 'note') + '</span> ' +
          '<strong style="font-size:13.5px">' + esc(i[1]) + '</strong>' +
          '<div class="muted" style="margin-top:3px;font-size:13px">' + esc(i[2]) + '</div></div>');
      });
      H.push('</div>');
    } else {
      H.push('<div class="muted" style="margin-top:11px">No weaknesses found in the generated policy.</div>');
    }
    H.push('</div></section>');

    H.push('<section><div class="note">Ship this as <code>Content-Security-Policy-Report-Only</code> first. ' +
      'The browser will report what it would have blocked without breaking the page, so you find the ' +
      'violations you have not hit yet before your users do.</div></section>');

    H.push('<section><div class="row"><button id="reset">Start over</button></div></section>');

    outEl.innerHTML = H.join('');
    outEl.hidden = false;

    Array.from(outEl.querySelectorAll('input[name=inline]')).forEach(r => {
      r.onchange = () => { state.inline = r.value; render(); };
    });
    const hd = $('#harden'); if (hd) hd.onchange = () => { state.harden = hd.checked; render(); };
    const ro = $('#ro'); if (ro) ro.onchange = () => { state.reportOnly = ro.checked; render(); };
    Array.from(outEl.querySelectorAll('[data-stack]')).forEach(b => {
      b.onclick = () => { state.stack = b.dataset.stack; render(); };
    });
    $('#cp').onclick = () => copy(deploy(state.stack, policyStr, state.reportOnly), 'Copied');
    $('#cp-report').onclick = () => copy(report(policyStr, g), 'Diagnosis copied');
    $('#reset').onclick = () => {
      outEl.hidden = true; outEl.innerHTML = '';
      $('#input').value = ''; $('#policy').value = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  function report(policyStr, g) {
    const L = ['CSP violation diagnosis', ''];
    L.push(state.violations.length + ' violations:');
    state.violations.forEach(v => {
      L.push('  [' + v.directive + '] ' + (KINDLABEL[v.kind] || v.kind) +
        (v.url ? ' -> ' + v.url : '') + (v.source ? '   (allow: ' + v.source + ')' : ''));
    });
    L.push('', 'Suggested policy:', '', policyStr, '');
    L.push('Grade: ' + g.letter + ' (' + g.score + '/100)');
    g.issues.forEach(i => L.push('  [' + i[0] + '] ' + i[1]));
    L.push('', 'Decoded with https://papercuts-mauve.vercel.app/csp');
    return L.join('\n');
  }

  $('#decode').onclick = run;
  $('#clear').onclick = () => {
    $('#input').value = ''; $('#policy').value = '';
    outEl.hidden = true; outEl.innerHTML = ''; statusEl.innerHTML = ''; $('#input').focus();
  };
  $('#input').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });
})();
