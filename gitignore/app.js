/* Why isn't my .gitignore working? — 100% client-side.
   Reimplements git's ignore matching: anchoring, negation, directory-only
   patterns, character classes, ** globs, last-match-wins, and the rule that an
   excluded directory is never descended into. */
(function () {
  'use strict';
  const { $, esc, toast, copy, fmt } = window.PC;

  const escLit = ch => ('.*+?^${}()|[]\\'.indexOf(ch) >= 0 ? '\\' + ch : ch);

  /* pattern body -> regex source (no anchors) */
  function globToRe(pat) {
    let re = '', i = 0;
    const n = pat.length;
    while (i < n) {
      const c = pat[i];
      if (c === '*') {
        if (pat[i + 1] === '*') {
          const prevSlash = i === 0 || pat[i - 1] === '/';
          const nextSlash = pat[i + 2] === '/';
          if (prevSlash && nextSlash) { re += '(?:.*/)?'; i += 3; continue; }
          if (prevSlash && i + 2 === n) { re += '.*'; i += 2; continue; }
          re += '[^/]*'; i += 2; continue;
        }
        re += '[^/]*'; i++; continue;
      }
      if (c === '?') { re += '[^/]'; i++; continue; }
      if (c === '[') {
        let j = i + 1, cls = '[';
        if (pat[j] === '!') { cls += '^'; j++; }
        else if (pat[j] === '^') { cls += '\\^'; j++; }
        if (pat[j] === ']') { cls += '\\]'; j++; }
        while (j < n && pat[j] !== ']') {
          if (pat[j] === '\\' && j + 1 < n) { cls += '\\' + pat[j + 1]; j += 2; continue; }
          cls += pat[j] === '[' ? '\\[' : pat[j];
          j++;
        }
        if (j < n) { re += cls + ']'; i = j + 1; continue; }
        re += '\\['; i++; continue;
      }
      if (c === '\\' && i + 1 < n) { re += escLit(pat[i + 1]); i += 2; continue; }
      re += escLit(c); i++;
    }
    return re;
  }

  /* Parse one .gitignore line into a rule, or null if it is blank/comment. */
  function parseLine(raw, lineNo) {
    let line = raw;
    if (/^\s*$/.test(line)) return null;
    if (/^#/.test(line)) return null;
    /* trailing whitespace is stripped unless escaped */
    line = line.replace(/((?:^|[^\\])(?:\\\\)*)\s+$/, function (m, keep) { return keep; });
    if (!line) return null;

    let negate = false;
    if (line[0] === '!') { negate = true; line = line.slice(1); }
    else if (line.slice(0, 2) === '\\!') { line = line.slice(1); }
    else if (line.slice(0, 2) === '\\#') { line = line.slice(1); }

    let dirOnly = false;
    if (line.length > 1 && line[line.length - 1] === '/') { dirOnly = true; line = line.slice(0, -1); }
    if (!line) return null;

    /* A slash anywhere but the (already removed) trailing one anchors the pattern. */
    let anchored = line.indexOf('/') !== -1;
    if (line[0] === '/') { line = line.slice(1); anchored = true; }

    const body = globToRe(line);
    const source = anchored ? '^' + body + '$' : '^(?:.*/)?' + body + '$';
    let re;
    try { re = new RegExp(source); } catch (e) { return null; }

    return { line: lineNo, raw: raw, pattern: line, negate: negate,
      dirOnly: dirOnly, anchored: anchored, re: re };
  }

  function parseIgnore(text) {
    const rules = [];
    text.split(/\r?\n/).forEach((l, i) => {
      const r = parseLine(l, i + 1);
      if (r) rules.push(r);
    });
    return rules;
  }

  /* Last matching rule wins, at a single path level. */
  function matchAt(rules, sub, isDir) {
    let hit = null;
    for (const r of rules) {
      if (r.dirOnly && !isDir) continue;
      if (r.re.test(sub)) hit = r;
    }
    return hit;
  }

  /* Decide one path, walking ancestors first the way git does. */
  function decide(path, rules) {
    let p = path.trim().replace(/^\.\//, '').replace(/^\/+/, '');
    const explicitDir = /\/$/.test(p);
    p = p.replace(/\/+$/, '');
    if (!p) return null;

    const parts = p.split('/');
    for (let i = 0; i < parts.length; i++) {
      const sub = parts.slice(0, i + 1).join('/');
      const isLast = i === parts.length - 1;
      const isDir = !isLast || explicitDir;
      const hit = matchAt(rules, sub, isDir);

      if (hit && !hit.negate) {
        if (isLast) return { path: p, isDir: explicitDir, ignored: true, by: hit };
        /* An excluded directory is never descended into, so any deeper
           re-include is unreachable. Detect that specifically — it is the
           single most confusing gitignore behaviour. */
        const deeper = matchAt(rules, p, explicitDir);
        return {
          path: p, isDir: explicitDir, ignored: true, by: hit, blockedAt: sub,
          trap: deeper && deeper.negate ? deeper : null
        };
      }
      if (isLast) return { path: p, isDir: explicitDir, ignored: !!(hit && !hit.negate), by: hit };
    }
    return { path: p, isDir: explicitDir, ignored: false, by: null };
  }

  function analyse(ignoreText, pathsText) {
    const rules = parseIgnore(ignoreText);
    const paths = pathsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const results = paths.map(p => decide(p, rules)).filter(Boolean);
    const traps = results.filter(r => r.trap);
    const unreachable = rules.filter(r => r.negate).filter(neg =>
      results.some(res => res.trap && res.trap.line === neg.line));
    return { rules: rules, results: results, traps: traps, unreachable: unreachable };
  }

  /* Suggest the contents-not-directory rewrite for a trapped negation. */
  function suggestFix(trapResult) {
    const dir = trapResult.blockedAt;
    return [dir + '/*', '!' + trapResult.trap.pattern];
  }

  window.PapercutsGitignore = { parseLine, parseIgnore, globToRe, decide, analyse, suggestFix };

  /* -------------------------------------------------------------- render */
  if (!document.getElementById('rules')) return;

  const statusEl = $('#status'), outEl = $('#out');

  function run() {
    const ig = $('#rules').value, ps = $('#paths').value;
    if (!ig.trim()) {
      statusEl.innerHTML = '<section><div class="err">Paste your .gitignore on the left.</div></section>';
      outEl.hidden = true; return;
    }
    if (!ps.trim()) {
      statusEl.innerHTML = '<section><div class="err">Add at least one path on the right to test.</div></section>';
      outEl.hidden = true; return;
    }
    const a = analyse(ig, ps);
    if (!a.rules.length) {
      statusEl.innerHTML = '<section><div class="err">No usable patterns found — every line was blank or a comment.</div></section>';
      outEl.hidden = true; return;
    }
    statusEl.innerHTML = '';
    render(a);
  }

  function ruleLabel(r) {
    return '<span class="lineno">line ' + r.line + '</span><code class="rule">' + esc(r.raw.trim()) + '</code>';
  }

  function render(a) {
    const ignored = a.results.filter(r => r.ignored).length;
    const tracked = a.results.length - ignored;
    const H = [];

    H.push('<section><div class="card pad" style="border-color:var(--' +
      (a.traps.length ? 'bad' : 'ok') + ')">');
    H.push('<h2 style="margin:0;font-size:19px">' + fmt(ignored) + ' ignored, ' +
      fmt(tracked) + ' not ignored' +
      (a.traps.length ? ' — and ' + fmt(a.traps.length) + ' re-include that silently does nothing' : '') +
      '</h2>');
    H.push('<div class="muted" style="margin-top:4px">' + fmt(a.rules.length) + ' active pattern' +
      (a.rules.length === 1 ? '' : 's') + ' &middot; ' + fmt(a.results.length) + ' path' +
      (a.results.length === 1 ? '' : 's') + ' tested</div></div></section>');

    /* the trap */
    if (a.traps.length) {
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">The re-include trap</h2>');
      const seen = new Set();
      a.traps.forEach(t => {
        const key = t.blockedAt + '|' + t.trap.line;
        if (seen.has(key)) return;
        seen.add(key);
        const fix = suggestFix(t);
        H.push('<div class="card pad" style="margin-bottom:8px;border-color:var(--bad)">' +
          '<span class="badge bad">does nothing</span> <strong style="margin-left:6px">' +
          esc(t.trap.raw.trim()) + ' on line ' + t.trap.line + ' never runs</strong>' +
          '<div class="muted" style="margin-top:6px">Line ' + t.by.line + ' (<code>' + esc(t.by.raw.trim()) +
          '</code>) excludes the directory <code>' + esc(t.blockedAt) + '</code>. Git does not descend into an ' +
          'excluded directory, so it never sees <code>' + esc(t.path) + '</code> and the exception cannot apply.</div>' +
          '<div style="margin-top:9px"><span class="muted">Exclude the contents instead of the directory:</span>' +
          '<pre class="code" style="margin-top:6px;background:var(--panel-2);border:1px solid var(--line);' +
          'border-radius:8px;padding:11px 13px;font-family:var(--mono);font-size:12.5px;overflow-x:auto">' +
          esc(fix.join('\n')) + '</pre></div></div>');
      });
      H.push('</section>');
    }

    /* per path */
    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Path by path</h2>');
    H.push('<div class="tablewrap"><table class="res"><thead><tr><th>Path</th><th>Result</th>' +
      '<th>Decided by</th><th>Why</th></tr></thead><tbody>');
    a.results.forEach(r => {
      H.push('<tr><td>' + esc(r.path) + (r.isDir ? '/' : '') + '</td>');
      H.push('<td><span class="verd ' + (r.ignored ? 'ig' : 'tr') + '">' +
        (r.ignored ? 'ignored' : 'NOT ignored') + '</span></td>');
      H.push('<td>' + (r.by ? ruleLabel(r.by) : '<span class="muted">no pattern matched</span>') + '</td>');
      let why;
      if (r.trap) why = 'Excluded because <code>' + esc(r.blockedAt) + '</code> is excluded. Your ' +
        '<code>' + esc(r.trap.raw.trim()) + '</code> on line ' + r.trap.line + ' cannot rescue it.';
      else if (r.blockedAt) why = 'Excluded by its parent directory <code>' + esc(r.blockedAt) + '</code>.';
      else if (!r.by) why = 'Nothing here matches it, so git will track it.';
      else if (r.by.negate) why = 'Re-included by the negation on line ' + r.by.line + ', which is the last line that matches.';
      else why = 'Matched by line ' + r.by.line + ', the last matching pattern.';
      H.push('<td class="muted">' + why + '</td></tr>');
    });
    H.push('</tbody></table></div></section>');

    /* already-tracked reminder + commands */
    const ig2 = a.results.filter(r => r.ignored);
    H.push('<section><div class="card pad" style="border-color:var(--warn)">' +
      '<span class="badge warn">read this first</span> ' +
      '<strong style="margin-left:6px">A pattern cannot ignore a file git already tracks</strong>' +
      '<div class="muted" style="margin-top:6px">If a path above says <em>ignored</em> but still shows up in ' +
      '<code>git status</code>, the pattern is fine and the file is simply already in the index. Untrack it, ' +
      'keeping it on disk:</div>');
    if (ig2.length) {
      /* -r only for actual directories; a file path does not need it. */
      const cmds = ig2.slice(0, 25).map(r =>
        'git rm --cached ' + (r.isDir ? '-r ' : '') + shq(r.path)).join('\n');
      H.push('<pre class="code" id="cmds" style="margin-top:9px;background:var(--panel-2);border:1px solid var(--line);' +
        'border-radius:8px;padding:12px 14px;font-family:var(--mono);font-size:12.5px;overflow-x:auto">' +
        esc(cmds) + '</pre>');
      H.push('<div class="row" style="margin-top:9px"><button class="primary" id="cp-cmds">Copy commands</button>' +
        '<button id="cp-report">Copy the full explanation</button></div>');
      H.push('<p class="muted" style="margin:9px 0 0">These remove the files from git\'s index only — nothing is ' +
        'deleted from your disk. Commit afterwards for the change to take effect.</p>');
    }
    H.push('</div></section>');

    H.push('<section><div class="row"><button id="reset">Start over</button></div></section>');

    outEl.innerHTML = H.join('');
    outEl.hidden = false;
    const c1 = $('#cp-cmds');
    if (c1) c1.onclick = () => copy($('#cmds').textContent, 'Commands copied');
    const c2 = $('#cp-report');
    if (c2) c2.onclick = () => copy(report(a), 'Explanation copied');
    $('#reset').onclick = () => {
      outEl.hidden = true; outEl.innerHTML = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const shq = s => /^[A-Za-z0-9._\/-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'";

  function report(a) {
    const L = ['.gitignore analysis', ''];
    a.results.forEach(r => {
      L.push((r.ignored ? '[ignored]     ' : '[not ignored] ') + r.path + (r.isDir ? '/' : ''));
      if (r.by) L.push('    by line ' + r.by.line + ': ' + r.by.raw.trim());
      if (r.trap) L.push('    TRAP: line ' + r.trap.line + ' ("' + r.trap.raw.trim() +
        '") never runs, because ' + r.blockedAt + ' is excluded.');
    });
    if (a.traps.length) {
      L.push('', 'Fix the trap by excluding contents rather than the directory:');
      const seen = new Set();
      a.traps.forEach(t => {
        const k = t.blockedAt + '|' + t.trap.line;
        if (seen.has(k)) return; seen.add(k);
        suggestFix(t).forEach(l => L.push('    ' + l));
      });
    }
    L.push('', 'Remember: .gitignore has no effect on files git already tracks.');
    L.push('Untrack with: git rm --cached <path>   (the file stays on disk)');
    L.push('', 'Checked with https://papercuts-mauve.vercel.app/gitignore');
    return L.join('\n');
  }

  const SAMPLE_RULES = [
    '# build output',
    'build/',
    '!build/keep.txt',
    '',
    '# logs',
    '*.log',
    '!important.log',
    '*.log',
    '',
    'node_modules/',
    '.env*',
    '!.env.example',
    '/dist',
    'doc/build'
  ].join('\n');

  const SAMPLE_PATHS = [
    'build/keep.txt',
    'build/bundle.js',
    'important.log',
    'src/app.log',
    'node_modules/react/index.js',
    '.env.local',
    '.env.example',
    'dist/main.js',
    'src/dist/main.js',
    'doc/build/index.html',
    'src/index.js'
  ].join('\n');

  $('#sample').onclick = () => {
    $('#rules').value = SAMPLE_RULES;
    $('#paths').value = SAMPLE_PATHS;
    run();
  };
  $('#run').onclick = run;
  $('#clear').onclick = () => {
    $('#rules').value = ''; $('#paths').value = '';
    outEl.hidden = true; outEl.innerHTML = ''; statusEl.innerHTML = ''; $('#rules').focus();
  };
  [$('#rules'), $('#paths')].forEach(el => el.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  }));
})();
