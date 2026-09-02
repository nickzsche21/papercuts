/* Will this survive being pasted? — 100% client-side.
   Each destination applies its real, default-on transformations and records
   exactly what it changed and why. */
(function () {
  'use strict';
  const { $, esc, toast, copy, fmt } = window.PC;

  const SQ_OPEN = '‘', SQ_CLOSE = '’';
  const DQ_OPEN = '“', DQ_CLOSE = '”';
  const ENDASH = '–', EMDASH = '—', ELLIPSIS = '…';
  const NBSP = ' ', FI = 'ﬁ', FL = 'ﬂ';

  /* A change record: what was replaced, with what, and why it matters. */
  function apply(text, rules) {
    let out = text;
    const changes = [];
    for (const [re, rep, why] of rules) {
      /* Pass `rep` straight through rather than wrapping it in a callback.
         Wrapping meant a string replacement like '$1' was returned literally
         instead of being interpolated, so Jira links came out as "$1". */
      const before = out;
      out = out.replace(re, rep);
      if (out !== before) changes.push(why);
    }
    return { out: out, changes: changes };
  }

  /* Straight quotes become curly ones, the way a word processor does it:
     an apostrophe inside a word closes, a quote after whitespace opens. */
  const SMART_QUOTES = [
    [/(^|[\s([{])'/g, function (m, p) { return p + SQ_OPEN; }, 'Opening single quotes became ' + SQ_OPEN],
    [/'/g, SQ_CLOSE, 'Remaining apostrophes became ' + SQ_CLOSE],
    [/(^|[\s([{])"/g, function (m, p) { return p + DQ_OPEN; }, 'Opening double quotes became ' + DQ_OPEN],
    [/"/g, DQ_CLOSE, 'Remaining double quotes became ' + DQ_CLOSE]
  ];

  const DASHES = [
    [/(\S)--(\S)/g, function (m, a, b) { return a + EMDASH + b; }, 'A double hyphen became an em dash ' + EMDASH],
    [/ - /g, ' ' + ENDASH + ' ', 'A spaced hyphen became an en dash ' + ENDASH]
  ];

  const ELLIPSES = [[/\.\.\./g, ELLIPSIS, 'Three dots became a single ellipsis character']];

  const DESTINATIONS = [
    {
      id: 'word', name: 'Word / Outlook',
      note: 'AutoFormat as you type — fires when the text is typed or edited there',
      run: t => apply(t, [].concat(SMART_QUOTES, DASHES, ELLIPSES, [
        [/\(c\)/gi, '©', '(c) became the copyright sign'],
        [/->/g, '→', 'An ASCII arrow became a real arrow glyph'],
        [/^([a-z])/gm, function (m, c) { return c.toUpperCase(); },
          'The first letter of each line was capitalised']
      ]))
    },
    {
      id: 'gdocs', name: 'Google Docs',
      note: 'automatic substitution while typing',
      run: t => apply(t, [].concat(SMART_QUOTES, DASHES, ELLIPSES))
    },
    {
      id: 'notion', name: 'Notion',
      note: 'typographic replacement while typing in a text block',
      run: t => apply(t, [].concat(SMART_QUOTES, [
        [/(\S)--(\S)/g, function (m, a, b) { return a + EMDASH + b; }, 'A double hyphen became an em dash'],
        [/^#\s+/gm, '', 'A leading hash was consumed and turned the line into a heading']
      ], ELLIPSES))
    },
    {
      id: 'slack', name: 'Slack',
      note: 'formatting applied on send; quotes are left alone',
      run: t => apply(t, [
        [/(^|\s)\*([^*\s][^*]*)\*(?=\s|$)/g, function (m, p, inner) { return p + inner; },
          'Asterisks were consumed as bold markers and removed'],
        [/(^|\s)_([^_\s][^_]*)_(?=\s|$)/g, function (m, p, inner) { return p + inner; },
          'Underscores were consumed as italic markers and removed'],
        [/(^|\s)~([^~\s][^~]*)~(?=\s|$)/g, function (m, p, inner) { return p + inner; },
          'Tildes were consumed as strikethrough markers'],
        [/:\)/g, '\u{1F642}', 'An emoticon became an emoji'],
        [/<(https?:\/\/[^>]+)>/g, '$1', 'Angle brackets around a URL were stripped by autolinking']
      ])
    },
    {
      id: 'jira', name: 'Jira (wiki markup)',
      note: 'wiki markup applied on render — the classic underscore eater',
      run: t => apply(t, [
        [/(^|\s)_([^_\s][^_]*)_(?=\s|$)/g, function (m, p, inner) { return p + inner; },
          'Underscores were read as italics and removed'],
        [/(^|\s)\*([^*\s][^*]*)\*(?=\s|$)/g, function (m, p, inner) { return p + inner; },
          'Asterisks were read as bold and removed'],
        [/\{([a-z]+)\}/g, '', 'Braces were read as a macro and removed'],
        [/\[([^\]|]+)\|[^\]]+\]/g, '$1', 'A bracketed pair became a link and lost its target']
      ])
    },
    {
      id: 'pdf', name: 'Copied out of a PDF',
      note: 'extraction artefacts when copying out; varies by producer',
      run: t => apply(t, [
        [/fi/g, FI, 'The letters f and i became a single ligature glyph'],
        [/fl/g, FL, 'The letters f and l became a single ligature glyph'],
        [/ /g, NBSP, 'Spaces became non-breaking spaces'],
        [/-\n/g, '', 'A hyphen at a line break was a hyphenation artefact and vanished']
      ])
    },
    {
      id: 'ios', name: 'iOS / macOS keyboard',
      note: 'smart punctuation while typing',
      run: t => apply(t, [].concat(SMART_QUOTES, [
        [/(\S)--(\S)/g, function (m, a, b) { return a + EMDASH + b; }, 'A double hyphen became an em dash'],
        [/^([a-z])/gm, function (m, c) { return c.toUpperCase(); }, 'Autocapitalisation changed the first letter']
      ]))
    },
    {
      id: 'excel', name: 'An Excel cell',
      note: 'type coercion on paste',
      run: t => {
        const changes = [];
        let out = t;
        if (/^\s*[=+@]/.test(t) || (/^\s*-/.test(t) && !/^-?\d+(\.\d+)?$/.test(t.trim()))) {
          changes.push('The leading character made Excel treat this as a formula, not text');
          out = '#NAME?';
        } else if (/^\d{12,}$/.test(t.trim())) {
          changes.push('A long run of digits was shown in scientific notation');
          /* toExponential already emits the sign, so do not add another one. */
          out = Number(t.trim()).toExponential(5).toUpperCase();
        }
        return { out: out, changes: changes };
      }
    }
  ];

  /* ------------------------------------------------------------- verdicts */
  /* Would this still work if it were a command, a key, or an identifier? */
  const FATAL = new RegExp('[' + SQ_OPEN + SQ_CLOSE + DQ_OPEN + DQ_CLOSE + ENDASH + EMDASH + FI + FL + NBSP + ']');

  function verdict(original, result) {
    if (result.out === original) return { level: 'safe', label: 'survives', why: 'Nothing changed.' };
    if (FATAL.test(result.out) && !FATAL.test(original))
      return {
        level: 'fatal', label: 'will not run',
        why: 'A character was replaced with one that looks almost identical but is not interchangeable. ' +
          'A shell, a parser or a key comparison will reject this, and the error will not mention it.'
      };
    if (result.out.length < original.length)
      return {
        level: 'fatal', label: 'text deleted',
        why: 'Characters were consumed as formatting and are simply gone. This is worse than mangling, ' +
          'because the result still looks like a plausible value.'
      };
    return {
      level: 'mangled', label: 'altered',
      why: 'The text changed. It may still work, but it is no longer what you wrote.'
    };
  }

  /* Highlight every character that differs from the original, so the damage
     is visible in text where it is designed not to be. */
  function highlight(original, out) {
    const changed = new Set();
    for (const ch of out) if (original.indexOf(ch) === -1) changed.add(ch);
    let html = '';
    for (const ch of out) {
      const e = esc(ch);
      html += changed.has(ch) ? '<mark title="' + esc(codeName(ch)) + '">' + e + '</mark>' : e;
    }
    return html || '<span class="muted">(empty)</span>';
  }

  function codeName(ch) {
    const cp = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    const names = { '2018': 'left single quote', '2019': 'right single quote',
      '201C': 'left double quote', '201D': 'right double quote', '2013': 'en dash',
      '2014': 'em dash', '2026': 'ellipsis', '00A0': 'no-break space',
      'FB01': 'fi ligature', 'FB02': 'fl ligature', '2192': 'rightwards arrow',
      '00A9': 'copyright sign' };
    return 'U+' + cp + (names[cp] ? ' — ' + names[cp] : '');
  }

  function analyse(text) {
    return DESTINATIONS.map(d => {
      const r = d.run(text);
      return { dest: d, out: r.out, changes: r.changes, verdict: verdict(text, r) };
    });
  }

  function chain(text, ids) {
    let cur = text;
    const steps = [];
    for (const id of ids) {
      const d = DESTINATIONS.find(x => x.id === id);
      if (!d) continue;
      const r = d.run(cur);
      steps.push({ dest: d, from: cur, out: r.out, changes: r.changes });
      cur = r.out;
    }
    return { steps: steps, final: cur, verdict: verdict(text, { out: cur }) };
  }

  window.PapercutsPaste = { analyse, chain, verdict, DESTINATIONS, apply };

  /* --------------------------------------------------------------- render */
  if (!document.getElementById('input')) return;

  const statusEl = $('#status'), outEl = $('#out');
  let chainIds = ['word', 'slack'];

  const SAMPLES = [
    ['A curl command', "curl -X POST --header 'Content-Type: application/json' https://api.example.com/v1/items"],
    ['An npm flag', 'npm install --save-dev --legacy-peer-deps my_cool_package'],
    ['A variable name', 'export DB_HOST_NAME="localhost" # set __init__ path'],
    ['A generated password', "Tr0ub4dor&3--'x'...Zz"],
    ['A git command', 'git log --oneline --since="2 weeks ago" -- src/my_module/'],
    ['A word from a PDF', 'redefine the workflow classification']
  ];
  $('#samples').innerHTML = SAMPLES.map((s, i) =>
    '<button data-s="' + i + '" style="font-size:12.5px;padding:6px 11px;border-radius:999px">' +
    esc(s[0]) + '</button>').join('');
  Array.from(document.querySelectorAll('[data-s]')).forEach(b => {
    b.onclick = () => { $('#input').value = SAMPLES[+b.dataset.s][1]; run(); };
  });

  function run() {
    const text = $('#input').value;
    if (!text.trim()) {
      statusEl.innerHTML = '<section><div class="err">Paste something first, or pick one of the samples.</div></section>';
      outEl.hidden = true; return;
    }
    if (text.length > 20000) {
      statusEl.innerHTML = '<section><div class="err">That is very long. Try a single command or snippet.</div></section>';
      return;
    }
    statusEl.innerHTML = '';
    render(text, analyse(text));
  }

  function render(text, results) {
    const fatal = results.filter(r => r.verdict.level === 'fatal');
    const safe = results.filter(r => r.verdict.level === 'safe');
    const H = [];

    H.push('<section><div class="card pad" style="border-color:var(--' +
      (fatal.length ? 'bad' : safe.length === results.length ? 'ok' : 'warn') + ')">');
    H.push('<h2 style="margin:0;font-size:19px">' + (fatal.length
      ? 'Broken by ' + fmt(fatal.length) + ' of ' + fmt(results.length) + ' destinations'
      : safe.length === results.length
        ? 'Survives everywhere'
        : 'Altered, but nothing fatal') + '</h2>');
    H.push('<div class="muted" style="margin-top:4px">' +
      (fatal.length
        ? esc(fatal.map(r => r.dest.name).join(', ')) + ' will produce something that looks right and is not.'
        : 'Nothing here will silently change the meaning.') + '</div></div></section>');

    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Destination by destination</h2><div class="dests">');
    results.forEach(r => {
      H.push('<div class="dest ' + r.verdict.level + '">');
      H.push('<h4>' + esc(r.dest.name) + '<span class="v">' + esc(r.verdict.label) + '</span></h4>');
      H.push('<div class="muted" style="font-size:11.5px;margin-top:2px">' + esc(r.dest.note) + '</div>');
      H.push('<div class="out">' + highlight(text, r.out) + '</div>');
      if (r.changes.length) {
        H.push('<div class="why"><b>What it did:</b> ' +
          r.changes.map(esc).join('. ') + '.</div>');
      }
      if (r.verdict.level !== 'safe')
        H.push('<div class="why">' + esc(r.verdict.why) + '</div>');
      H.push('</div>');
    });
    H.push('</div></section>');

    /* the compounding chain */
    const c = chain(text, chainIds);
    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Now send it through more than one</h2>');
    H.push('<div class="card pad"><div class="chain">');
    H.push('<span class="muted">You write it</span><span class="arrow">&rarr;</span>');
    chainIds.forEach((id, i) => {
      H.push('<select data-chain="' + i + '">' + DESTINATIONS.map(d =>
        '<option value="' + d.id + '"' + (d.id === id ? ' selected' : '') + '>' +
        esc(d.name) + '</option>').join('') + '</select>');
      H.push('<span class="arrow">&rarr;</span>');
    });
    H.push('<span class="muted">someone runs it</span>');
    H.push('<button id="addhop" style="font-size:12px;padding:5px 10px">+ hop</button>');
    if (chainIds.length > 1) H.push('<button id="delhop" style="font-size:12px;padding:5px 10px">&minus; hop</button>');
    H.push('</div>');
    c.steps.forEach((s, i) => {
      H.push('<div style="margin-top:11px"><div class="muted" style="font-size:12px">' +
        'After ' + esc(s.dest.name) + (s.changes.length ? '' : ' (no change)') + '</div>' +
        '<div class="out">' + highlight(text, s.out) + '</div></div>');
    });
    H.push('<div class="note" style="margin-top:12px">' +
      (c.final === text
        ? 'This particular route leaves it intact.'
        : '<strong>' + esc(c.verdict.label) + '.</strong> ' + esc(c.verdict.why)) + '</div>');
    H.push('</div></section>');

    /* the fix */
    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Send this instead</h2>');
    H.push('<div class="card pad"><div class="muted" style="font-size:13px">A fenced code block is respected by ' +
      'every destination above — none of them autocorrect inside one.</div>' +
      '<div class="out" style="margin-top:8px">' + esc('```\n' + text + '\n```') + '</div>' +
      '<div class="row" style="margin-top:9px"><button class="primary" id="cp-safe">Copy the safe version</button>' +
      '<button id="cp-report">Copy the damage report</button>' +
      '<button id="reset">Try something else</button></div></div></section>');

    outEl.innerHTML = H.join('');
    outEl.hidden = false;

    Array.from(outEl.querySelectorAll('[data-chain]')).forEach(sel => {
      sel.onchange = () => { chainIds[+sel.dataset.chain] = sel.value; render(text, results); };
    });
    $('#addhop').onclick = () => { chainIds.push('jira'); render(text, results); };
    const del = $('#delhop');
    if (del) del.onclick = () => { chainIds.pop(); render(text, results); };
    $('#cp-safe').onclick = () => copy('```\n' + text + '\n```', 'Fenced version copied');
    $('#cp-report').onclick = () => copy(report(text, results, c), 'Report copied');
    $('#reset').onclick = () => {
      outEl.hidden = true; outEl.innerHTML = ''; $('#input').value = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function report(text, results, c) {
    const L = ['What each destination does to this text', '', 'Original:', '  ' + text, ''];
    results.forEach(r => {
      L.push('[' + r.verdict.label.toUpperCase() + '] ' + r.dest.name);
      if (r.out !== text) L.push('  -> ' + r.out);
      r.changes.forEach(ch => L.push('     ' + ch));
    });
    L.push('', 'Chained through ' + c.steps.map(s => s.dest.name).join(' then ') + ':');
    L.push('  ' + c.final);
    L.push('', 'Safe to paste anywhere:', '```', text, '```');
    L.push('', 'Checked with https://papercuts-mauve.vercel.app/paste-damage');
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
