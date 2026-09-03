/* COPY failed: file not found in build context — 100% client-side.
 *
 * Implements Docker's documented .dockerignore rules: patterns are relative to
 * the context root (never matched at arbitrary depth the way .gitignore does),
 * Go-style * ? and [] that do not cross a separator, ** spanning directories,
 * ! exceptions, and last-match-wins.
 *
 * This is a reimplementation, not the daemon. Docker was not available on the
 * machine this was written on, so it could not be differentially tested against
 * the real matcher the way the gitignore tool was against real git. The page
 * says so rather than implying more confidence than is earned.
 */
(function () {
  'use strict';
  const { $, esc, toast, copy, fmt } = window.PC;

  const escLit = ch => ('.+^${}()|\\'.indexOf(ch) >= 0 ? '\\' + ch : ch);

  /* Docker pattern -> anchored regex source. */
  function toRe(p) {
    let re = '', i = 0;
    const n = p.length;
    while (i < n) {
      if (p.startsWith('**/', i)) { re += '(?:[^/]+/)*'; i += 3; continue; }
      if (p.startsWith('/**', i) && i + 3 === n) { re += '(?:/.*)?'; i += 3; continue; }
      if (p.startsWith('**', i)) { re += '.*'; i += 2; continue; }
      const c = p[i];
      if (c === '*') { re += '[^/]*'; i++; continue; }
      if (c === '?') { re += '[^/]'; i++; continue; }
      if (c === '[') {
        let j = i + 1, cls = '[';
        if (p[j] === '!' || p[j] === '^') { cls += '^'; j++; }
        if (p[j] === ']') { cls += '\\]'; j++; }
        while (j < n && p[j] !== ']') {
          cls += (p[j] === '\\' && j + 1 < n) ? '\\' + p[++j] : (p[j] === '[' ? '\\[' : p[j]);
          j++;
        }
        if (j < n) { re += cls + ']'; i = j + 1; continue; }
        re += '\\['; i++; continue;
      }
      if (c === '\\' && i + 1 < n) { re += escLit(p[i + 1]); i += 2; continue; }
      re += escLit(c); i++;
    }
    return '^' + re + '$';
  }

  function parseLine(raw, lineNo) {
    let line = raw.replace(/\r$/, '').trim();
    if (!line || line[0] === '#') return null;

    let negate = false;
    if (line[0] === '!') { negate = true; line = line.slice(1).trim(); }

    /* Leading and trailing separators are stripped: everything is root-relative. */
    line = line.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!line || line === '.') return null;

    let re;
    try { re = new RegExp(toRe(line)); } catch (e) { return null; }

    /* A bare name with no separator and no ** only matches at the root here,
       which is exactly where it differs from .gitignore. */
    const bareName = line.indexOf('/') === -1 && line.indexOf('**') === -1;

    return { line: lineNo, raw: raw.trim(), pattern: line, negate: negate,
      re: re, bareName: bareName };
  }

  function parseIgnore(text) {
    const rules = [];
    text.split('\n').forEach((l, i) => { const r = parseLine(l, i + 1); if (r) rules.push(r); });
    return rules;
  }

  const norm = p => p.trim().replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');

  /* A pattern that matches a directory excludes everything beneath it, so each
     ancestor is tested too. Last match across the whole list wins. */
  function decide(path, rules) {
    const p = norm(path);
    if (!p) return null;
    const parts = p.split('/');
    const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join('/'));

    let excluded = false, by = null, matchedOn = null;
    for (const r of rules) {
      for (const pre of prefixes) {
        if (r.re.test(pre)) { excluded = !r.negate; by = r; matchedOn = pre; break; }
      }
    }
    return { path: p, excluded: excluded, by: by, matchedOn: matchedOn };
  }

  /* Would .gitignore have treated this pattern differently? */
  function gitDivergence(rules, paths) {
    const out = [];
    for (const r of rules) {
      if (!r.bareName) continue;
      /* git would match this name at any depth; docker only at the root */
      const missed = paths.map(norm).filter(p => {
        const segs = p.split('/');
        return segs.length > 1 && segs.slice(0, -1).concat(segs.slice(-1))
          .some((s, i) => i > 0 && new RegExp(toRe(r.pattern)).test(s));
      });
      if (missed.length) out.push({ rule: r, missed: missed, fix: '**/' + r.pattern });
    }
    return out;
  }

  function analyse(ignoreText, pathsText) {
    const rules = parseIgnore(ignoreText);
    const paths = pathsText.split('\n').map(s => s.trim()).filter(Boolean);
    const results = paths.map(p => decide(p, rules)).filter(Boolean);
    return {
      rules: rules, results: results,
      divergence: gitDivergence(rules, paths),
      excluded: results.filter(r => r.excluded).length
    };
  }

  /* Diagnose a failing COPY instruction. */
  function diagnoseCopy(line, rules, paths) {
    const m = /^\s*COPY\s+(?:--[^\s]+\s+)*(.+?)\s+(\S+)\s*$/i.exec(line) ||
              /^\s*ADD\s+(?:--[^\s]+\s+)*(.+?)\s+(\S+)\s*$/i.exec(line);
    const src = m ? m[1].trim().split(/\s+/)[0] : line.trim();
    if (!src) return null;

    const issues = [];
    if (/^\.\.(\/|$)/.test(src) || src.includes('/../'))
      issues.push({ sev: 'bad', title: 'The source is outside the build context',
        why: 'The daemon only ever receives the context directory. A path that climbs above it with .. cannot be reached, no matter what the .dockerignore says. Move the file inside the context, or build with a context that contains it.' });
    if (/^\//.test(src) && !/^\/\//.test(src))
      issues.push({ sev: 'warn', title: 'The source looks absolute',
        why: 'COPY sources are always relative to the build context root. A leading slash is interpreted relative to the context anyway, which is rarely what the author meant.' });

    const clean = norm(src.replace(/^\.\//, ''));
    const d = clean ? decide(clean, rules) : null;
    if (d && d.excluded) {
      issues.push({ sev: 'bad', title: 'This path is excluded by your .dockerignore',
        why: 'Line ' + d.by.line + ' (' + d.by.raw + ') matched ' +
          (d.matchedOn === d.path ? 'it directly' : 'its parent directory ' + d.matchedOn) +
          ', so the file never reaches the daemon and COPY cannot see it.' });
    }
    const known = paths.map(norm);
    if (clean && known.length && !known.some(p => p === clean || p.startsWith(clean + '/')) &&
        !/[*?\[]/.test(clean))
      issues.push({ sev: 'warn', title: 'That path is not in the list you pasted',
        why: 'Nothing in the path list matches it, which usually means the file is somewhere else relative to the context root, or the case does not match. The daemon compares case-sensitively even when your filesystem does not.' });

    return { src: src, dest: m ? m[2] : null, issues: issues, decision: d };
  }

  window.PapercutsDockerignore = {
    parseLine, parseIgnore, toRe, decide, analyse, gitDivergence, diagnoseCopy, norm
  };

  /* -------------------------------------------------------------- render */
  if (!document.getElementById('rules')) return;

  const statusEl = $('#status'), outEl = $('#out');

  function run() {
    const ig = $('#rules').value, ps = $('#paths').value;
    if (!ig.trim()) { err('Paste your .dockerignore on the left.'); return; }
    if (!ps.trim()) { err('Add some paths on the right — <code>git ls-files</code> pastes straight in.'); return; }
    const a = analyse(ig, ps);
    if (!a.rules.length) { err('No usable patterns — every line was blank or a comment.'); return; }
    statusEl.innerHTML = '';
    a.copy = $('#copysrc').value.trim()
      ? diagnoseCopy($('#copysrc').value, a.rules, ps.split('\n').filter(Boolean)) : null;
    render(a);
  }

  function err(html) {
    statusEl.innerHTML = '<section><div class="err">' + html + '</div></section>';
    outEl.hidden = true;
  }

  function ruleLabel(r) {
    return '<span class="lineno">line ' + r.line + '</span><code class="rule">' + esc(r.raw) + '</code>';
  }

  function render(a) {
    const H = [];
    const kept = a.results.length - a.excluded;

    H.push('<section><div class="card pad" style="border-color:var(--' +
      (a.divergence.length ? 'bad' : 'ok') + ')">');
    H.push('<h2 style="margin:0;font-size:19px">' + fmt(a.excluded) + ' excluded, ' +
      fmt(kept) + ' sent to the daemon' +
      (a.divergence.length ? ' — and ' + fmt(a.divergence.length) +
        ' pattern' + (a.divergence.length === 1 ? '' : 's') + ' not doing what you think' : '') + '</h2>');
    H.push('<div class="muted" style="margin-top:4px">' + fmt(a.rules.length) + ' active pattern' +
      (a.rules.length === 1 ? '' : 's') + ' &middot; ' + fmt(a.results.length) + ' path' +
      (a.results.length === 1 ? '' : 's') + ' checked</div></div></section>');

    /* the COPY diagnosis leads when one was given */
    if (a.copy && a.copy.issues.length) {
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Why that COPY fails</h2>');
      a.copy.issues.forEach(i => {
        H.push('<div class="card pad" style="margin-bottom:8px;border-color:var(--' +
          (i.sev === 'bad' ? 'bad' : 'warn') + ')">' +
          '<span class="badge ' + (i.sev === 'bad' ? 'bad' : 'warn') + '">' +
          (i.sev === 'bad' ? 'this is it' : 'check this') + '</span> ' +
          '<strong style="margin-left:6px">' + esc(i.title) + '</strong>' +
          '<div class="muted" style="margin-top:5px">' + esc(i.why) + '</div></div>');
      });
      H.push('</section>');
    } else if (a.copy) {
      H.push('<section><div class="note"><strong>' + esc(a.copy.src) + '</strong> is not excluded by ' +
        'any of these patterns, and nothing obvious is wrong with the path. If COPY still cannot find ' +
        'it, check that the build context is the directory you think it is — in ' +
        '<code>docker build -f docker/Dockerfile .</code> the context is <code>.</code>, so sources are ' +
        'relative to the repository root rather than to the Dockerfile.</div></section>');
    }

    /* the git divergence — the reason this tool exists */
    if (a.divergence.length) {
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">These behave differently than in .gitignore</h2>');
      a.divergence.forEach(d => {
        H.push('<div class="card pad" style="margin-bottom:10px;border-color:var(--bad)">' +
          '<span class="badge bad">root only</span> <strong style="margin-left:6px">' +
          '<code>' + esc(d.rule.pattern) + '</code> on line ' + d.rule.line +
          ' only matches at the context root</strong>');
        H.push('<div class="cmp" style="margin-top:11px">' +
          '<div><h4>In .gitignore</h4><p>Matches <code>' + esc(d.rule.pattern) +
          '</code> at any depth, anywhere in the tree.</p></div>' +
          '<div class="mid">vs</div>' +
          '<div><h4>In .dockerignore</h4><p>Matches only <code>./' + esc(d.rule.pattern) +
          '</code>. Everything nested is still copied.</p></div></div>');
        H.push('<div class="muted" style="margin-top:10px">Still being sent to the daemon: <code>' +
          d.missed.slice(0, 4).map(esc).join('</code>, <code>') + '</code>' +
          (d.missed.length > 4 ? ' and ' + fmt(d.missed.length - 4) + ' more' : '') + '</div>');
        H.push('<div style="margin-top:9px"><span class="muted">Write this instead:</span>' +
          '<pre class="code" style="margin-top:6px;background:var(--panel-2);border:1px solid var(--line);' +
          'border-radius:8px;padding:11px 13px;font-family:var(--mono);font-size:12.5px;overflow-x:auto">' +
          esc(d.fix) + '</pre></div></div>');
      });
      H.push('</section>');
    }

    /* per path */
    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Path by path</h2>');
    H.push('<div class="tablewrap" style="max-height:460px;overflow:auto"><table class="res"><thead><tr>' +
      '<th>Path</th><th>Result</th><th>Decided by</th><th>Why</th></tr></thead><tbody>');
    a.results.forEach(r => {
      H.push('<tr><td>' + esc(r.path) + '</td>');
      H.push('<td><span class="verd ' + (r.excluded ? 'exc' : 'inc') + '">' +
        (r.excluded ? 'excluded' : 'sent') + '</span></td>');
      H.push('<td>' + (r.by ? ruleLabel(r.by) : '<span class="muted">no pattern matched</span>') + '</td>');
      let why;
      if (!r.by) why = 'Nothing matches it, so it goes into the build context.';
      else if (r.by.negate) why = 'Re-included by the exception on line ' + r.by.line + ', the last line that matches.';
      else if (r.matchedOn !== r.path) why = 'Its parent <code>' + esc(r.matchedOn) + '</code> matched line ' + r.by.line + '.';
      else why = 'Matched line ' + r.by.line + ', the last matching pattern.';
      H.push('<td class="muted">' + why + '</td></tr>');
    });
    H.push('</tbody></table></div></section>');

    H.push('<section><div class="note"><strong>One file, at the context root.</strong> Unlike ' +
      '<code>.gitignore</code>, a <code>.dockerignore</code> in a subdirectory does nothing. If yours ' +
      'sits next to the Dockerfile but you build with the repository root as the context, it is being ' +
      'ignored completely.</div></section>');

    H.push('<section><div class="row"><button id="cp">Copy the explanation</button>' +
      '<button id="reset">Start over</button></div></section>');

    outEl.innerHTML = H.join('');
    outEl.hidden = false;
    $('#cp').onclick = () => copy(report(a), 'Explanation copied');
    $('#reset').onclick = () => { outEl.hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' }); };
    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function report(a) {
    const L = ['.dockerignore analysis', ''];
    if (a.copy) {
      L.push('COPY source: ' + a.copy.src);
      a.copy.issues.forEach(i => L.push('  [' + i.sev.toUpperCase() + '] ' + i.title + ' — ' + i.why));
      L.push('');
    }
    a.divergence.forEach(d => {
      L.push('PATTERN "' + d.rule.pattern + '" (line ' + d.rule.line + ') only matches at the context root.');
      L.push('  In .gitignore it would match at any depth. Still being copied: ' + d.missed.slice(0, 5).join(', '));
      L.push('  Write instead: ' + d.fix);
      L.push('');
    });
    a.results.forEach(r => {
      L.push((r.excluded ? '[excluded] ' : '[sent]     ') + r.path +
        (r.by ? '   <- line ' + r.by.line + ': ' + r.by.raw : ''));
    });
    L.push('', 'Remember: .dockerignore is one file at the build context root. A copy in a',
      'subdirectory does nothing.', '',
      'Checked with https://papercuts-mauve.vercel.app/dockerignore');
    return L.join('\n');
  }

  const SAMPLE_RULES = [
    '# the classic monorepo mistake',
    'node_modules',
    '*.log',
    '.git',
    '',
    '# keep one thing from an excluded directory',
    'dist',
    '!dist/manifest.json',
    '',
    '.env*',
    '!.env.example'
  ].join('\n');

  const SAMPLE_PATHS = [
    'package.json',
    'node_modules/react/index.js',
    'packages/ui/node_modules/left-pad/index.js',
    'apps/web/node_modules/lodash/index.js',
    'src/index.js',
    'src/debug.log',
    'dist/bundle.js',
    'dist/manifest.json',
    '.env.local',
    '.env.example',
    '.git/HEAD'
  ].join('\n');

  $('#sample').onclick = () => {
    $('#rules').value = SAMPLE_RULES;
    $('#paths').value = SAMPLE_PATHS;
    $('#copysrc').value = 'COPY ./dist/manifest.json /srv/manifest.json';
    run();
  };
  $('#run').onclick = run;
  $('#clear').onclick = () => {
    $('#rules').value = ''; $('#paths').value = ''; $('#copysrc').value = '';
    outEl.hidden = true; statusEl.innerHTML = ''; $('#rules').focus();
  };
  [$('#rules'), $('#paths'), $('#copysrc')].forEach(el => el.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  }));
})();
