/* Will my regex work everywhere? — 100% client-side.
   The pattern is scanned for constructs, never compiled or executed. */
(function () {
  'use strict';
  const { $, esc, toast, copy, fmt } = window.PC;

  const ENGINES = [
    { id: 'js', name: 'JavaScript', note: 'V8, ES2018+' },
    { id: 'py', name: 'Python re', note: 'stdlib, 3.11+' },
    { id: 'go', name: 'Go', note: 'RE2, linear time' },
    { id: 'rust', name: 'Rust / ripgrep', note: 'RE2-style' },
    { id: 'java', name: 'Java', note: 'java.util.regex' },
    { id: 'dotnet', name: '.NET', note: 'System.Text.RegularExpressions' },
    { id: 'pcre', name: 'PCRE2 / PHP', note: 'preg_*' },
    { id: 'ruby', name: 'Ruby', note: 'Onigmo' },
    { id: 'ere', name: 'grep -E / awk', note: 'POSIX ERE' },
    { id: 'pg', name: 'PostgreSQL', note: 'the ~ operator' }
  ];

  /* y = supported, n = not supported, p = partial (see note) */
  const FEATURES = [
    { id: 'lookahead', label: 'Lookahead  (?=…) (?!…)',
      s: { js:'y', py:'y', go:'n', rust:'n', java:'y', dotnet:'y', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      why: 'RE2-based engines exclude lookaround to guarantee linear-time matching.',
      fix: 'In Go or Rust there is no equivalent. Match a wider pattern and check the surrounding text in code.' },

    { id: 'lookbehind', label: 'Lookbehind  (?<=…) (?<!…)',
      s: { js:'y', py:'p', go:'n', rust:'n', java:'p', dotnet:'y', pcre:'p', ruby:'p', ere:'n', pg:'n' },
      notes: { py:'fixed width only', java:'bounded length only', pcre:'fixed width, or use \\K', ruby:'fixed width only' },
      why: 'Support is uneven: only JavaScript and .NET allow a variable-length lookbehind.',
      fix: 'Capture the prefix in a group and drop it afterwards, which works in every engine.' },

    { id: 'varlookbehind', label: 'Variable-length lookbehind',
      s: { js:'y', py:'n', go:'n', rust:'n', java:'n', dotnet:'y', pcre:'p', ruby:'n', ere:'n', pg:'n' },
      notes: { pcre:'PCRE2 allows alternatives of differing fixed lengths, not true variability' },
      why: 'Your lookbehind can match more than one length, which most engines reject outright.',
      fix: 'Split into alternatives of equal length, or capture the prefix instead.' },

    { id: 'backref', label: 'Backreference  \\1  \\k<name>',
      s: { js:'y', py:'y', go:'n', rust:'n', java:'y', dotnet:'y', pcre:'y', ruby:'y', ere:'p', pg:'y' },
      notes: { ere:'POSIX BRE has \\1; ERE officially does not' },
      why: 'Backreferences make linear-time matching impossible, so RE2-based engines omit them.',
      fix: 'In Go or Rust, capture the group and compare the two values in code.' },

    { id: 'namedAngle', label: 'Named group  (?<name>…)',
      s: { js:'y', py:'n', go:'n', rust:'y', java:'y', dotnet:'y', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      why: 'Python’s re and Go accept only the (?P<name>…) spelling.',
      fix: 'Rewrite as (?P<name>…) for Python and Go — the translation below does it.' },

    { id: 'namedP', label: 'Named group  (?P<name>…)',
      s: { js:'n', py:'y', go:'y', rust:'y', java:'n', dotnet:'n', pcre:'y', ruby:'n', ere:'n', pg:'n' },
      why: 'The (?P…) spelling is a Python invention that JavaScript, Java and .NET reject.',
      fix: 'Rewrite as (?<name>…) for JavaScript, Java and .NET — see the translation below.' },

    { id: 'atomic', label: 'Atomic group  (?>…)',
      s: { js:'n', py:'p', go:'n', rust:'n', java:'y', dotnet:'y', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      notes: { py:'Python 3.11 and later only' },
      why: 'Atomic groups prevent backtracking into a section. JavaScript has never supported them.',
      fix: 'In JavaScript, emulate with a lookahead and a backreference: (?=(pattern))\\1' },

    { id: 'possessive', label: 'Possessive quantifier  a++  a*+',
      s: { js:'n', py:'p', go:'n', rust:'n', java:'y', dotnet:'n', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      notes: { py:'Python 3.11 and later only' },
      why: 'A possessive quantifier is shorthand for an atomic group and is missing from several engines, including .NET.',
      fix: 'Rewrite a++ as the atomic group (?>a+), which .NET and Java both accept.' },

    { id: 'recursion', label: 'Recursion  (?R)  \\g<0>',
      s: { js:'n', py:'n', go:'n', rust:'n', java:'n', dotnet:'p', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      notes: { dotnet:'no (?R), but balancing groups can do similar work' },
      why: 'Recursive patterns are a PCRE and Ruby extension. Almost nothing else has them.',
      fix: 'Nested structures usually want a real parser rather than a regex.' },

    { id: 'conditional', label: 'Conditional  (?(1)yes|no)',
      s: { js:'n', py:'y', go:'n', rust:'n', java:'n', dotnet:'y', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      why: 'Conditionals on whether a group matched exist only in a few engines.',
      fix: 'Express the two cases as a plain alternation instead.' },

    { id: 'keepout', label: 'Match reset  \\K',
      s: { js:'n', py:'n', go:'n', rust:'n', java:'n', dotnet:'n', pcre:'y', ruby:'n', ere:'n', pg:'n' },
      why: '\\K discards everything matched so far. It is a PCRE-only feature.',
      fix: 'Use a lookbehind where available, or capture and slice in code.' },

    { id: 'uniprop', label: 'Unicode property  \\p{L}',
      s: { js:'p', py:'n', go:'y', rust:'y', java:'y', dotnet:'y', pcre:'p', ruby:'y', ere:'n', pg:'n' },
      notes: { js:'requires the u or v flag', pcre:'requires a UTF mode build', py:'stdlib re has none; the regex module adds it' },
      why: 'Unicode property escapes are widely but not universally available, and several engines gate them behind a flag.',
      fix: 'In Python, install the regex module, or spell out the character ranges.' },

    { id: 'inlineGlobal', label: 'Inline flags  (?i)',
      s: { js:'n', py:'y', go:'y', rust:'y', java:'y', dotnet:'y', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      why: 'JavaScript has no inline flag syntax at all — flags live outside the pattern.',
      fix: 'For JavaScript, move it to the flags argument: new RegExp(pattern, "i")' },

    { id: 'inlineScoped', label: 'Scoped inline flags  (?i:…)',
      s: { js:'n', py:'y', go:'y', rust:'y', java:'y', dotnet:'y', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      why: 'Applying a flag to part of a pattern is impossible in JavaScript.',
      fix: 'In JavaScript, write the case variants out, or apply the flag to the whole pattern.' },

    { id: 'comment', label: 'Inline comment  (?#…)',
      s: { js:'n', py:'y', go:'n', rust:'n', java:'n', dotnet:'y', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      why: 'Inline comments are not universal and are a syntax error where unsupported.',
      fix: 'Delete them, or use extended/verbose mode with ordinary # comments.' },

    { id: 'anchorAZ', label: 'String anchors  \\A  \\z  \\Z',
      s: { js:'n', py:'y', go:'y', rust:'y', java:'y', dotnet:'y', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      why: 'JavaScript has only ^ and $, whose meaning changes with the m flag.',
      fix: 'In JavaScript use ^ and $ without the m flag to anchor to the whole string.' },

    { id: 'hspace', label: 'Horizontal whitespace  \\h  \\R',
      s: { js:'n', py:'n', go:'n', rust:'n', java:'y', dotnet:'n', pcre:'y', ruby:'y', ere:'n', pg:'n' },
      why: 'These shorthands are Perl-lineage extensions missing from most engines.',
      fix: 'Write \\h as [ \\t], and \\R as (?:\\r\\n|[\\r\\n]).' },

    { id: 'branchReset', label: 'Branch reset  (?|…)',
      s: { js:'n', py:'n', go:'n', rust:'n', java:'n', dotnet:'n', pcre:'y', ruby:'n', ere:'n', pg:'n' },
      why: 'Branch reset groups are PCRE-only.',
      fix: 'Use separate group numbers and pick whichever one matched.' }
  ];

  /* --------------------------------------------------------------- detect */
  /* Scans the pattern, tracking escapes and character classes so that
     constructs written inside [...] are not mistaken for real syntax. */
  function detect(pattern) {
    const found = Object.create(null);
    const hit = id => { found[id] = (found[id] || 0) + 1; };
    let inClass = false;
    const n = pattern.length;
    const groups = [];              /* for lookbehind width analysis */

    for (let i = 0; i < n; i++) {
      const c = pattern[i];

      if (c === '\\') {
        const d = pattern[i + 1];
        if (d === undefined) break;
        if (!inClass) {
          if (/[1-9]/.test(d)) hit('backref');
          if (d === 'k' && /[<'{]/.test(pattern[i + 2] || '')) hit('backref');
          if (d === 'g' && /[<{'0-9]/.test(pattern[i + 2] || '')) hit('recursion');
          if (d === 'K') hit('keepout');
          if (d === 'A' || d === 'z' || d === 'Z') hit('anchorAZ');
          if (d === 'h' || d === 'H' || d === 'R' || d === 'X') hit('hspace');
        }
        if (d === 'p' || d === 'P') { if (pattern[i + 2] === '{') hit('uniprop'); }
        i++;
        continue;
      }

      if (inClass) { if (c === ']') inClass = false; continue; }
      if (c === '[') { inClass = true; continue; }

      if (c === '(') {
        const rest = pattern.slice(i);
        if (/^\(\?P[<=]/.test(rest)) {
          if (/^\(\?P</.test(rest)) hit('namedP'); else hit('backref');
          continue;
        }
        if (/^\(\?<[=!]/.test(rest)) {
          hit('lookbehind');
          groups.push({ start: i, kind: 'lookbehind' });
          continue;
        }
        if (/^\(\?</.test(rest) || /^\(\?'/.test(rest)) { hit('namedAngle'); continue; }
        if (/^\(\?[=!]/.test(rest)) { hit('lookahead'); continue; }
        if (/^\(\?>/.test(rest)) { hit('atomic'); continue; }
        if (/^\(\?R\)/.test(rest) || /^\(\?0\)/.test(rest)) { hit('recursion'); continue; }
        if (/^\(\?\(/.test(rest)) { hit('conditional'); continue; }
        if (/^\(\?#/.test(rest)) { hit('comment'); continue; }
        if (/^\(\?\|/.test(rest)) { hit('branchReset'); continue; }
        if (/^\(\?[a-zA-Z-]+\)/.test(rest)) { hit('inlineGlobal'); continue; }
        if (/^\(\?[a-zA-Z-]+:/.test(rest)) { hit('inlineScoped'); continue; }
        continue;
      }

      /* possessive quantifiers: *+ ++ ?+ {n,m}+ */
      if ((c === '*' || c === '+' || c === '?') && pattern[i + 1] === '+') { hit('possessive'); i++; continue; }
      if (c === '}' && pattern[i + 1] === '+') { hit('possessive'); i++; continue; }
    }

    /* variable-length lookbehind: inspect each lookbehind body */
    if (found['lookbehind']) {
      for (const g of groups) {
        const body = extractGroup(pattern, g.start);
        if (body === null) continue;
        const inner = body.replace(/^\(\?<[=!]/, '').replace(/\)$/, '');
        if (isVariableWidth(inner)) { hit('varlookbehind'); break; }
      }
    }
    return found;
  }

  /* Return the full text of the group starting at `start`, or null. */
  function extractGroup(pattern, start) {
    let depth = 0, inClass = false;
    for (let i = start; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '\\') { i++; continue; }
      if (inClass) { if (c === ']') inClass = false; continue; }
      if (c === '[') { inClass = true; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return pattern.slice(start, i + 1); }
    }
    return null;
  }

  /* Approximate: unbounded quantifiers, or alternatives of differing length. */
  function isVariableWidth(src) {
    let inClass = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') { i++; continue; }
      if (inClass) { if (c === ']') inClass = false; continue; }
      if (c === '[') { inClass = true; continue; }
      if (c === '*' || c === '+' || c === '?') return true;
      if (c === '{') {
        const m = /^\{(\d+)(,(\d*)?)?\}/.exec(src.slice(i));
        if (m && m[2] && m[3] !== m[1]) return true;   /* {2,5} or {2,} */
      }
    }
    const alts = splitAlternation(src);
    if (alts.length > 1) {
      const lens = alts.map(approxLen);
      if (lens.some(l => l !== lens[0])) return true;
    }
    return false;
  }

  function splitAlternation(src) {
    const out = []; let cur = '', depth = 0, inClass = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') { cur += c + (src[i + 1] || ''); i++; continue; }
      if (inClass) { cur += c; if (c === ']') inClass = false; continue; }
      if (c === '[') { inClass = true; cur += c; continue; }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  /* crude literal length, good enough to spot differing alternatives */
  function approxLen(src) {
    let n = 0, inClass = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') { n++; i++; continue; }
      if (inClass) { if (c === ']') { inClass = false; n++; } continue; }
      if (c === '[') { inClass = true; continue; }
      if ('()|'.indexOf(c) >= 0) continue;
      n++;
    }
    return n;
  }

  /* ------------------------------------------------------------ translate */
  function translate(pattern, target) {
    let out = pattern;
    if (target === 'py' || target === 'go') {
      out = out.replace(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g, (m, name) => '(?P<' + name + '>');
      out = out.replace(/\\k<([A-Za-z_][A-Za-z0-9_]*)>/g, (m, name) => '(?P=' + name + ')');
    } else if (target === 'js' || target === 'java' || target === 'dotnet') {
      out = out.replace(/\(\?P<([A-Za-z_][A-Za-z0-9_]*)>/g, (m, name) => '(?<' + name + '>');
      out = out.replace(/\(\?P=([A-Za-z_][A-Za-z0-9_]*)\)/g, (m, name) => '\\k<' + name + '>');
    }
    if (target === 'dotnet' || target === 'js') {
      /* possessive -> atomic where the engine has atomic groups */
      if (target === 'dotnet') out = out.replace(/([*+?])\+/g, '$1');
    }
    return out;
  }

  /* --------------------------------------------------------------- ReDoS */
  function redosRisk(pattern) {
    const risks = [];
    if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern))
      risks.push('A quantifier applied to a group that itself contains a quantifier, such as (a+)+. This is the classic catastrophic-backtracking shape.');
    if (/\(([^|)]+)\|\1\)[+*]/.test(pattern))
      risks.push('Alternation with overlapping branches under a quantifier, such as (a|a)*.');
    /* Only flag *directly adjacent, identical* unbounded classes. An earlier,
       looser version matched any two unbounded classes with something between
       them, which flagged ^[a-z]+@[a-z]+$ — an ordinary email pattern with a
       mandatory separator and no ambiguity at all. A false alarm here is worse
       than a miss, because it teaches people to ignore the warning. */
    const adjacent = /(\[[^\]]+\]|\\[dws]|\.)\s*[+*]\s*\1\s*[+*]/;
    if (adjacent.test(pattern))
      risks.push('Two identical unbounded classes directly next to each other, such as \\w+\\w+. Every split point between them is ambiguous, so the engine tries all of them.');
    return risks;
  }

  /* --------------------------------------------------------------- verdict */
  function analyse(pattern) {
    const found = detect(pattern);
    const used = FEATURES.filter(f => found[f.id]);
    const engines = ENGINES.map(e => {
      let worst = 'y';
      const blocking = [], partial = [];
      used.forEach(f => {
        const s = f.s[e.id];
        if (s === 'n') { worst = 'n'; blocking.push(f); }
        else if (s === 'p' && worst !== 'n') { worst = 'p'; partial.push(f); }
        else if (s === 'p') partial.push(f);
      });
      return { engine: e, status: worst, blocking: blocking, partial: partial };
    });
    return {
      pattern: pattern, found: found, used: used, engines: engines,
      ok: engines.filter(e => e.status === 'y').length,
      redos: redosRisk(pattern)
    };
  }

  window.PapercutsRegex = { detect, analyse, translate, isVariableWidth, redosRisk, FEATURES, ENGINES };

  /* --------------------------------------------------------------- render */
  if (!document.getElementById('input')) return;

  const statusEl = $('#status'), outEl = $('#out');

  const SAMPLES = [
    ['Lookbehind for a price', '(?<=\\$)\\d+(?:\\.\\d{2})?'],
    ['Repeated word (backreference)', '\\b(\\w+)\\s+\\1\\b'],
    ['Python-style named groups', '(?P<year>\\d{4})-(?P<month>\\d{2})'],
    ['JS-style named groups', '(?<year>\\d{4})-(?<month>\\d{2})'],
    ['Possessive + atomic', '(?>\\w++)@example\\.com'],
    ['Variable-length lookbehind', '(?<=foo|foobar)bar'],
    ['Catastrophic backtracking', '^(a+)+$'],
    ['Portable everywhere', '^[a-z0-9._%-]+@[a-z0-9.-]+\\.[a-z]{2,}$']
  ];
  $('#samples').innerHTML = SAMPLES.map((s, i) =>
    '<button data-s="' + i + '" style="font-size:12.5px;padding:6px 11px;border-radius:999px">' +
    esc(s[0]) + '</button>').join('');
  Array.from(document.querySelectorAll('[data-s]')).forEach(b => {
    b.onclick = () => { $('#input').value = SAMPLES[+b.dataset.s][1]; run(); };
  });

  const MARK = { y: '<span class="y">&#10003;</span>', n: '<span class="n">&#10007;</span>', p: '<span class="p">~</span>' };

  function run() {
    const p = $('#input').value.trim();
    if (!p) {
      statusEl.innerHTML = '<section><div class="err">Type a regular expression, or pick one of the samples.</div></section>';
      outEl.hidden = true; return;
    }
    statusEl.innerHTML = '';
    render(analyse(p));
  }

  function render(a) {
    const H = [];
    const broken = a.engines.filter(e => e.status === 'n');

    H.push('<section><div class="card pad" style="border-color:var(--' +
      (broken.length ? 'bad' : a.engines.some(e => e.status === 'p') ? 'warn' : 'ok') + ')">');
    /* Portability and performance are different axes: a pattern can use only
       basic syntax and still hang. Do not lead with reassurance in that case. */
    H.push('<h2 style="margin:0 0 4px;font-size:19px">' +
      (a.used.length === 0
        ? (a.redos.length
            ? 'Portable everywhere, but it can hang on hostile input'
            : 'Portable everywhere — only basic syntax used')
        : broken.length
          ? 'Breaks in ' + fmt(broken.length) + ' of ' + fmt(a.engines.length) + ' engines'
          : 'Works everywhere, with caveats in some engines') + '</h2>');
    H.push('<div class="muted pat">' + esc(a.pattern) + '</div></div></section>');

    /* engines */
    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">By engine</h2><div class="engines">');
    a.engines.forEach(e => {
      const cls = e.status === 'y' ? 'ok' : e.status === 'n' ? 'no' : 'part';
      const label = e.status === 'y' ? 'works' : e.status === 'n' ? 'will not compile' : 'restricted';
      H.push('<div class="eng ' + cls + '"><h4>' + esc(e.engine.name) + '</h4>' +
        '<div class="st">' + label + '</div>' +
        '<p>' + (e.blocking.length
          ? esc(e.blocking.map(f => f.label.split('  ')[0]).join(', ')) + ' unsupported'
          : e.partial.length
            ? esc(e.partial.map(f => (f.notes && f.notes[e.engine.id]) || 'restricted').join('; '))
            : esc(e.engine.note)) + '</p></div>');
    });
    H.push('</div></section>');

    if (!a.used.length) {
      H.push('<section><div class="note">This pattern uses only constructs every engine understands: ' +
        'literals, classes, groups, alternation and ordinary quantifiers. Nothing here needs translating.</div></section>');
    } else {
      /* matrix */
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">What you used</h2>');
      H.push('<div class="tablewrap"><table class="mx"><thead><tr><th>Feature</th>' +
        ENGINES.map(e => '<th title="' + esc(e.note) + '">' + esc(e.name.split(' ')[0]) + '</th>').join('') +
        '</tr></thead><tbody>');
      a.used.forEach(f => {
        H.push('<tr><td class="feat">' + esc(f.label) + '</td>' +
          ENGINES.map(e => {
            const s = f.s[e.id];
            const note = f.notes && f.notes[e.id];
            return '<td' + (note ? ' title="' + esc(note) + '"' : '') + '>' + MARK[s] + '</td>';
          }).join('') + '</tr>');
      });
      H.push('</tbody></table></div>');
      H.push('<p class="muted" style="margin:8px 0 0">' + MARK.y + ' supported &nbsp; ' +
        MARK.p + ' partial (hover for the restriction) &nbsp; ' + MARK.n + ' not supported</p></section>');

      /* explanations */
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">What to do about it</h2>');
      a.used.forEach(f => {
        const blocked = ENGINES.filter(e => f.s[e.id] === 'n').map(e => e.name);
        H.push('<div class="card pad" style="margin-bottom:8px">' +
          '<strong class="feat" style="font-size:13px">' + esc(f.label) + '</strong>' +
          (blocked.length ? ' <span class="badge bad" style="margin-left:6px">breaks in ' +
            esc(blocked.slice(0, 3).join(', ')) + (blocked.length > 3 ? ' +' + (blocked.length - 3) : '') + '</span>' : '') +
          '<div class="muted" style="margin-top:6px">' + esc(f.why) + '</div>' +
          '<div class="muted" style="margin-top:5px"><strong>Instead:</strong> ' + esc(f.fix) + '</div></div>');
      });
      H.push('</section>');

      /* translations */
      const tPy = translate(a.pattern, 'py'), tJs = translate(a.pattern, 'js');
      if (tPy !== a.pattern || tJs !== a.pattern) {
        H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Translated</h2>');
        if (tPy !== a.pattern) H.push(codeBlock('For Python and Go', tPy, 'cp-py'));
        if (tJs !== a.pattern) H.push(codeBlock('For JavaScript, Java and .NET', tJs, 'cp-js'));
        H.push('</section>');
      }
    }

    if (a.redos.length) {
      H.push('<section><div class="card pad" style="border-color:var(--bad)">' +
        '<span class="badge bad">performance</span> <strong style="margin-left:6px">' +
        'Catastrophic backtracking risk</strong>');
      a.redos.forEach(r => H.push('<div class="muted" style="margin-top:6px">' + esc(r) + '</div>'));
      H.push('<div class="muted" style="margin-top:8px">On a backtracking engine a crafted input can make ' +
        'this run for effectively forever, which is a denial-of-service vector when the input comes from a ' +
        'user. Go and Rust are immune by construction. Elsewhere, rewrite with an atomic group or make the ' +
        'branches mutually exclusive.</div></div></section>');
    }

    H.push('<section><div class="row"><button id="cp-report">Copy the report</button>' +
      '<button id="reset">Check another</button></div></section>');

    outEl.innerHTML = H.join('');
    outEl.hidden = false;
    const b1 = $('#cp-py'); if (b1) b1.onclick = () => copy(translate(a.pattern, 'py'), 'Python/Go version copied');
    const b2 = $('#cp-js'); if (b2) b2.onclick = () => copy(translate(a.pattern, 'js'), 'JavaScript version copied');
    $('#cp-report').onclick = () => copy(report(a), 'Report copied');
    $('#reset').onclick = () => {
      outEl.hidden = true; outEl.innerHTML = ''; $('#input').value = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function codeBlock(label, text, id) {
    return '<div style="margin-bottom:9px"><label>' + esc(label) + '</label>' +
      '<pre class="code" style="margin:6px 0 0;background:var(--panel-2);border:1px solid var(--line);' +
      'border-radius:8px;padding:12px 14px;font-family:var(--mono);font-size:12.5px;overflow-x:auto">' +
      esc(text) + '</pre>' +
      '<button id="' + id + '" style="margin-top:7px;font-size:12.5px">Copy</button></div>';
  }

  function report(a) {
    const L = ['Regex portability report', '', 'Pattern: ' + a.pattern, ''];
    a.engines.forEach(e => {
      L.push('  ' + (e.status === 'y' ? '[ok]     ' : e.status === 'n' ? '[BREAKS] ' : '[partial]') +
        ' ' + e.engine.name +
        (e.blocking.length ? ' — ' + e.blocking.map(f => f.label.split('  ')[0]).join(', ') + ' unsupported' : ''));
    });
    if (a.used.length) {
      L.push('', 'Features used:');
      a.used.forEach(f => { L.push('  ' + f.label); L.push('    ' + f.why); L.push('    Instead: ' + f.fix); });
    }
    if (a.redos.length) { L.push('', 'ReDoS risk:'); a.redos.forEach(r => L.push('  ' + r)); }
    L.push('', 'Checked with https://papercuts-mauve.vercel.app/regex-flavours');
    return L.join('\n');
  }

  $('#run').onclick = run;
  $('#clear').onclick = () => {
    $('#input').value = ''; outEl.hidden = true; outEl.innerHTML = '';
    statusEl.innerHTML = ''; $('#input').focus();
  };
  $('#input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
})();
