/* Watch your regex explode — a real backtracking engine, instrumented.
 *
 * The browser's own RegExp cannot tell you how much work it did, so this
 * implements the matcher: parse to an AST, match with continuation-passing
 * backtracking, and increment a counter on every attempt. Every number shown
 * on the page is measured by this engine, never estimated — except the
 * projection, which is labelled as one.
 */
(function () {
  'use strict';
  const { $, esc, toast, copy, fmt } = window.PC;

  const STEP_CAP = 5000000;          /* keeps the tab alive */
  const GROWTH_CAP = 400000;         /* per-length cap while charting */

  /* ---------------------------------------------------------------- parser */
  function parse(src) {
    let i = 0;
    let groupIndex = 0;

    function peek() { return src[i]; }
    function eat(c) { if (src[i] === c) { i++; return true; } return false; }

    function parseAlt() {
      const opts = [parseSeq()];
      while (eat('|')) opts.push(parseSeq());
      return opts.length === 1 ? opts[0] : { t: 'alt', opts: opts };
    }

    function parseSeq() {
      const items = [];
      while (i < src.length && src[i] !== '|' && src[i] !== ')') items.push(parseRep());
      return items.length === 1 ? items[0] : { t: 'seq', items: items };
    }

    function parseRep() {
      let node = parseAtom();
      for (;;) {
        const c = src[i];
        let min, max;
        if (c === '*') { min = 0; max = Infinity; i++; }
        else if (c === '+') { min = 1; max = Infinity; i++; }
        else if (c === '?') { min = 0; max = 1; i++; }
        else if (c === '{') {
          const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
          if (!m) break;
          min = +m[1];
          max = m[2] === undefined ? min : (m[3] === '' ? Infinity : +m[3]);
          i += m[0].length;
        } else break;
        let lazy = false, possessive = false;
        if (src[i] === '?') { lazy = true; i++; }
        else if (src[i] === '+') { possessive = true; i++; }
        node = { t: 'rep', node: node, min: min, max: max, lazy: lazy, possessive: possessive };
      }
      return node;
    }

    function parseClass() {
      const neg = eat('^');
      const ranges = [];
      if (src[i] === ']') { ranges.push([']', ']']); i++; }
      while (i < src.length && src[i] !== ']') {
        let lo = readClassChar();
        if (src[i] === '-' && src[i + 1] !== ']' && i + 1 < src.length) {
          i++;
          const hi = readClassChar();
          ranges.push([lo, hi]);
        } else ranges.push([lo, lo]);
      }
      if (!eat(']')) throw new Error('unterminated character class');
      return { t: 'class', neg: neg, ranges: ranges };
    }

    function readClassChar() {
      if (src[i] === '\\') { i++; return unescapeChar(src[i++]); }
      return src[i++];
    }

    const SHORTHAND = {
      d: { neg: false, ranges: [['0', '9']] },
      D: { neg: true, ranges: [['0', '9']] },
      w: { neg: false, ranges: [['a', 'z'], ['A', 'Z'], ['0', '9'], ['_', '_']] },
      W: { neg: true, ranges: [['a', 'z'], ['A', 'Z'], ['0', '9'], ['_', '_']] },
      s: { neg: false, ranges: [[' ', ' '], ['\t', '\t'], ['\n', '\n'], ['\r', '\r'], ['\f', '\f']] },
      S: { neg: true, ranges: [[' ', ' '], ['\t', '\t'], ['\n', '\n'], ['\r', '\r'], ['\f', '\f']] }
    };

    function unescapeChar(c) {
      if (c === 'n') return '\n';
      if (c === 't') return '\t';
      if (c === 'r') return '\r';
      if (c === 'f') return '\f';
      if (c === '0') return '\u0000';
      return c;
    }

    function parseAtom() {
      const c = src[i];
      if (c === undefined) return { t: 'seq', items: [] };
      if (c === '(') {
        i++;
        let capture = true, atomic = false;
        if (src[i] === '?') {
          if (src[i + 1] === ':') { capture = false; i += 2; }
          else if (src[i + 1] === '>') { capture = false; atomic = true; i += 2; }
          else if (src[i + 1] === '<' && /[A-Za-z_]/.test(src[i + 2] || '')) {
            const m = /^\?<([A-Za-z_][A-Za-z0-9_]*)>/.exec(src.slice(i));
            if (m) i += m[0].length; else throw new Error('unsupported group at ' + i);
          } else throw new Error('lookaround is not supported by this engine');
        }
        const idx = capture ? ++groupIndex : 0;
        const inner = parseAlt();
        if (!eat(')')) throw new Error('missing closing parenthesis');
        return { t: 'group', node: inner, idx: idx, atomic: atomic };
      }
      if (c === '[') { i++; return parseClass(); }
      if (c === '.') { i++; return { t: 'any' }; }
      if (c === '^') { i++; return { t: 'bol' }; }
      if (c === '$') { i++; return { t: 'eol' }; }
      if (c === '\\') {
        i++;
        const e = src[i++];
        if (e === undefined) throw new Error('trailing backslash');
        if (SHORTHAND[e]) return { t: 'class', neg: SHORTHAND[e].neg, ranges: SHORTHAND[e].ranges };
        if (e === 'b' || e === 'B') return { t: 'word-boundary', neg: e === 'B' };
        if (/[1-9]/.test(e)) throw new Error('backreferences are not supported by this engine');
        return { t: 'char', c: unescapeChar(e) };
      }
      if (c === ')') throw new Error('unmatched closing parenthesis');
      i++;
      return { t: 'char', c: c };
    }

    const ast = parseAlt();
    if (i < src.length) throw new Error('unexpected "' + src[i] + '" at position ' + i);
    return { ast: ast, groups: groupIndex };
  }

  /* --------------------------------------------------------------- matcher */
  function Halt() {}

  const isWord = ch => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

  function inClass(node, ch) {
    if (ch === undefined) return false;
    let hit = false;
    for (const [lo, hi] of node.ranges) { if (ch >= lo && ch <= hi) { hit = true; break; } }
    return node.neg ? !hit : hit;
  }

  /* Runs the match from one start position. Returns end index or -1. */
  function runAt(ast, str, start, ctx) {
    function step(pos) {
      ctx.steps++;
      if (ctx.visits) ctx.visits[pos] = (ctx.visits[pos] || 0) + 1;
      if (ctx.steps > ctx.cap) throw new Halt();
    }

    function m(node, pos, k) {
      step(pos);
      switch (node.t) {
        case 'char':
          return str[pos] === node.c ? k(pos + 1) : false;
        case 'any':
          return pos < str.length && str[pos] !== '\n' ? k(pos + 1) : false;
        case 'class':
          return inClass(node, str[pos]) ? k(pos + 1) : false;
        case 'bol':
          return pos === 0 ? k(pos) : false;
        case 'eol':
          return pos === str.length ? k(pos) : false;
        case 'word-boundary': {
          const b = isWord(str[pos - 1]) !== isWord(str[pos]);
          return (node.neg ? !b : b) ? k(pos) : false;
        }
        case 'seq': {
          const go = (idx, p) => idx === node.items.length ? k(p) : m(node.items[idx], p, p2 => go(idx + 1, p2));
          return go(0, pos);
        }
        case 'alt': {
          for (const o of node.opts) if (m(o, pos, k)) return true;
          return false;
        }
        case 'group': {
          if (!node.atomic) return m(node.node, pos, k);
          /* Atomic: keep only the first way the inner pattern matches. */
          let end = -1;
          m(node.node, pos, p => { end = p; return true; });
          return end === -1 ? false : k(end);
        }
        case 'rep': {
          const { min, max, lazy, possessive } = node;
          if (possessive) {
            let count = 0, p = pos;
            for (;;) {
              if (count >= max) break;
              let next = -1;
              m(node.node, p, p2 => { next = p2; return true; });
              if (next === -1 || next === p) break;
              p = next; count++;
            }
            return count >= min ? k(p) : false;
          }
          const tryFrom = (count, p) => {
            step(p);
            if (lazy) {
              if (count >= min && k(p)) return true;
              if (count < max) return m(node.node, p, p2 => p2 !== p && tryFrom(count + 1, p2));
              return false;
            }
            if (count < max && m(node.node, p, p2 => p2 !== p && tryFrom(count + 1, p2))) return true;
            return count >= min && k(p);
          };
          return tryFrom(0, pos);
        }
        default:
          return false;
      }
    }

    let end = -1;
    m(ast, start, p => { end = p; return true; });
    return end;
  }

  /* Full search: try every start position, like an unanchored match. */
  function search(ast, str, cap, trackVisits) {
    const ctx = { steps: 0, cap: cap, visits: trackVisits ? new Array(str.length + 1).fill(0) : null };
    let matched = null, halted = false;
    try {
      for (let s = 0; s <= str.length; s++) {
        const end = runAt(ast, str, s, ctx);
        if (end !== -1) { matched = { start: s, end: end }; break; }
      }
    } catch (e) {
      if (e instanceof Halt) halted = true; else throw e;
    }
    return { steps: ctx.steps, match: matched, visits: ctx.visits, halted: halted };
  }

  /* --------------------------------------------------------------- growth */
  /* Measured, not modelled — but the family of inputs has to be chosen with
     care. Growing plain prefixes of "aaaa...!" gives "a", "aa", "aaa", all of
     which MATCH instantly, so the explosion never appears and the pattern looks
     linear. The blow-up lives on the failure path, so when the full string does
     not match, the failing tail is kept and only the body grows. */
  function growth(ast, str) {
    const full = search(ast, str, GROWTH_CAP, false);
    const failing = full.match === null && str.length > 1;
    const tail = failing ? str[str.length - 1] : '';
    const bodyLen = failing ? str.length - 1 : str.length;
    const points = [];
    for (let n = 1; n <= bodyLen; n++) {
      const input = str.slice(0, n) + tail;
      const r = search(ast, input, GROWTH_CAP, false);
      points.push({ n: input.length, steps: r.steps, halted: r.halted });
      if (r.halted) break;
    }
    return points;
  }

  /* Exponential is judged by the per-character ratio; polynomial by the
     log-log slope, which is ~1 for linear work and ~2 for quadratic. */
  function classify(points) {
    const usable = points.filter(p => !p.halted && p.steps > 0);
    const ratioOf = pts => {
      if (pts.length < 2) return 1;
      const rs = [];
      for (let i = 1; i < pts.length; i++) if (pts[i - 1].steps > 0) rs.push(pts[i].steps / pts[i - 1].steps);
      return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 1;
    };

    /* Blowing the cap is itself the answer. */
    if (points.some(p => p.halted)) {
      return { kind: 'exponential', ratio: Math.max(1.8, ratioOf(usable.slice(-6))) };
    }
    if (usable.length < 4) return { kind: 'unknown', ratio: 1 };

    const tail = usable.slice(-6);
    const ratio = ratioOf(tail);
    if (ratio >= 1.5) return { kind: 'exponential', ratio: ratio };

    const a = tail[0], b = tail[tail.length - 1];
    const slope = (b.n > a.n && a.steps > 0)
      ? (Math.log(b.steps) - Math.log(a.steps)) / (Math.log(b.n) - Math.log(a.n))
      : 1;
    if (slope > 1.6) return { kind: 'polynomial', ratio: ratio, slope: slope };
    return { kind: 'linear', ratio: ratio, slope: slope };
  }

  /* Extrapolate — explicitly an estimate, and labelled as one in the UI. */
  function project(points, cls, targetLen) {
    const usable = points.filter(p => !p.halted && p.steps > 0);
    if (!usable.length || cls.kind === 'linear') return null;
    const last = usable[usable.length - 1];
    const extra = targetLen - last.n;
    if (extra <= 0) return null;
    const steps = last.steps * Math.pow(cls.ratio, extra);
    return isFinite(steps) ? steps : Infinity;
  }

  const STEPS_PER_SEC = 5e7;   /* a compiled engine, order of magnitude */
  function humanTime(steps) {
    if (!isFinite(steps)) return 'longer than the age of the universe';
    const s = steps / STEPS_PER_SEC;
    if (s < 0.001) return 'under a millisecond';
    if (s < 1) return Math.round(s * 1000) + ' ms';
    if (s < 60) return s.toFixed(1) + ' seconds';
    if (s < 3600) return (s / 60).toFixed(1) + ' minutes';
    if (s < 86400) return (s / 3600).toFixed(1) + ' hours';
    if (s < 31536000) return (s / 86400).toFixed(1) + ' days';
    const y = s / 31536000;
    if (y > 1e12) return 'longer than the age of the universe';
    if (y > 1e6) return (y / 1e6).toPrecision(3) + ' million years';
    return y.toPrecision(3) + ' years';
  }

  /* ------------------------------------------------------------- suggest */
  function suggestFixes(pattern) {
    const out = [];
    const nested = /\(([^()]*[+*][^()]*)\)\s*[+*]/.exec(pattern);
    if (nested) {
      out.push({
        label: 'Make the inner group atomic',
        pattern: pattern.replace(nested[0], '(?>' + nested[1] + ')' + nested[0].slice(-1)),
        why: 'An atomic group refuses to reconsider what it matched, which removes the ambiguity entirely. Available in PCRE, Java, .NET, Ruby and Python 3.11+, but not JavaScript.'
      });
      out.push({
        label: 'Make the inner quantifier possessive',
        pattern: pattern.replace(nested[0], '(' + nested[1].replace(/([+*])(?!\+)/, '$1+') + ')' + nested[0].slice(-1)),
        why: 'Possessive quantifiers are shorthand for the same thing. PCRE, Java, Ruby and Python 3.11+; not JavaScript or .NET.'
      });
    }
    return out;
  }

  window.PapercutsBacktrack = {
    parse, search, growth, classify, project, humanTime, suggestFixes, runAt, STEP_CAP
  };

  /* --------------------------------------------------------------- render */
  if (!document.getElementById('pat')) return;

  const statusEl = $('#status'), outEl = $('#out');

  const PRESETS = [
    ['boom', 'The classic', '^(a+)+$', 'aaaaaaaaaaaaaaaaaaaa!'],
    ['boom', 'Overlapping alternation', '^(a|a)*$', 'aaaaaaaaaaaaaaaaaaaa!'],
    ['boom', 'Naive email validator', '^([a-zA-Z0-9]+)*@example\\.com$', 'aaaaaaaaaaaaaaaaaaaa!'],
    ['boom', 'Nested optional', '^(a?){20}a{20}$', 'aaaaaaaaaaaaaaaaaaaaa'],
    ['safe', 'Atomic group, defused', '^(?>a+)+$', 'aaaaaaaaaaaaaaaaaaaa!'],
    ['safe', 'Possessive, defused', '^(a++)+$', 'aaaaaaaaaaaaaaaaaaaa!'],
    ['safe', 'A sane email pattern', '^[a-z0-9._%-]+@[a-z0-9.-]+\\.[a-z]{2,}$', 'ada@example.com'],
    ['safe', 'Plain and linear', '^\\d{3}-\\d{4}$', '555-0142']
  ];

  $('#presets').innerHTML = PRESETS.map((p, i) =>
    '<button class="' + p[0] + '" data-p="' + i + '">' + esc(p[1]) + '</button>').join('');
  Array.from(document.querySelectorAll('[data-p]')).forEach(b => {
    b.onclick = () => {
      const p = PRESETS[+b.dataset.p];
      $('#pat').value = p[2]; $('#str').value = p[3]; run();
    };
  });

  function run() {
    const pattern = $('#pat').value;
    const str = $('#str').value;
    if (!pattern) { fail('Enter a pattern.'); return; }
    if (str.length > 200) { fail('Keep the test string under 200 characters — this engine is doing the work in your tab.'); return; }

    let parsed;
    try { parsed = parse(pattern); }
    catch (e) {
      fail('This engine could not parse that pattern: ' + esc(e.message) +
        '. It supports literals, classes, <code>.</code>, groups, alternation, anchors, ' +
        'and greedy, lazy, possessive and atomic repetition — but not lookaround or backreferences.');
      return;
    }

    statusEl.innerHTML = '';
    const main = search(parsed.ast, str, STEP_CAP, true);
    const pts = growth(parsed.ast, str);
    const cls = classify(pts);
    render({ pattern, str, main, pts, cls, fixes: suggestFixes(pattern) });
  }

  function fail(html) {
    statusEl.innerHTML = '<section><div class="err">' + html + '</div></section>';
    outEl.hidden = true;
  }

  function verdictOf(main, cls) {
    if (main.halted) return ['boom', 'Gave up after ' + fmt(STEP_CAP) + ' steps'];
    if (cls.kind === 'exponential') return ['boom', 'Exponential — every extra character multiplies the work'];
    if (cls.kind === 'polynomial') return ['warn', 'Superlinear — the work grows faster than the input'];
    if (main.steps > 10000) return ['warn', fmt(main.steps) + ' steps'];
    return ['safe', fmt(main.steps) + ' steps'];
  }

  function chart(pts) {
    const w = 640, h = 190, padL = 46, padB = 26, padT = 12, padR = 10;
    const usable = pts.filter(p => p.steps > 0);
    if (usable.length < 2) return '<p class="muted">Not enough data points to plot.</p>';
    const maxS = Math.max(...usable.map(p => p.steps));
    const maxN = Math.max(...usable.map(p => p.n));
    const ly = v => Math.log10(Math.max(1, v));
    const x = n => padL + (n / maxN) * (w - padL - padR);
    const y = s => h - padB - (ly(s) / ly(maxS)) * (h - padB - padT);
    const pathD = usable.map((p, i) => (i ? 'L' : 'M') + x(p.n).toFixed(1) + ' ' + y(p.steps).toFixed(1)).join(' ');
    const ticks = [];
    for (let e = 0; e <= Math.ceil(ly(maxS)); e++) {
      if (e % Math.max(1, Math.ceil(ly(maxS) / 5)) !== 0) continue;
      const v = Math.pow(10, e);
      ticks.push('<line class="grid" x1="' + padL + '" y1="' + y(v).toFixed(1) +
        '" x2="' + (w - padR) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text class="lbl" x="4" y="' + (y(v) + 3).toFixed(1) + '">' +
        (v >= 1000000 ? (v / 1000000) + 'M' : v >= 1000 ? (v / 1000) + 'k' : v) + '</text>');
    }
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" ' +
      'aria-label="Steps against input length, logarithmic">' + ticks.join('') +
      '<path class="line" d="' + pathD + '"/>' +
      usable.map(p => '<circle class="dot" cx="' + x(p.n).toFixed(1) + '" cy="' + y(p.steps).toFixed(1) +
        '" r="2.5"><title>' + p.n + ' chars: ' + fmt(p.steps) + ' steps</title></circle>').join('') +
      '<text class="lbl" x="' + padL + '" y="' + (h - 8) + '">1 char</text>' +
      '<text class="lbl" x="' + (w - padR - 46) + '" y="' + (h - 8) + '">' + maxN + ' chars</text>' +
      '</svg>';
  }

  function heat(str, visits) {
    if (!visits) return '';
    const max = Math.max(...visits, 1);
    const cols = [];
    for (let i = 0; i < str.length; i++) {
      const v = visits[i] || 0;
      const pct = Math.max(2, Math.round((v / max) * 100));
      const hot = v === max && max > 50;
      cols.push('<div class="col' + (hot ? ' hot' : '') + '" title="' + fmt(v) + ' visits">' +
        '<div class="bar" style="height:' + pct + '%"></div>' +
        '<span class="ch">' + esc(str[i] === ' ' ? '␣' : str[i]) + '</span></div>');
    }
    return '<div class="heat">' + cols.join('') + '</div>';
  }

  function render(r) {
    const [cls, headline] = verdictOf(r.main, r.cls);
    const H = [];

    H.push('<section><div class="card pad" style="border-color:var(--' +
      (cls === 'boom' ? 'bad' : cls === 'warn' ? 'warn' : 'ok') + ')">');
    H.push('<div class="runbar"><span class="odo ' + cls + '">' +
      (r.main.halted ? fmt(STEP_CAP) + '+' : fmt(r.main.steps)) + '</span>' +
      '<span class="muted">steps to ' + (r.main.match ? 'match' : 'decide it does not match') + '</span></div>');
    H.push('<h2 style="margin:9px 0 0;font-size:17px">' + esc(headline) + '</h2>');
    H.push('<div class="muted" style="margin-top:4px">' +
      '<code>' + esc(r.pattern) + '</code> against ' + r.str.length + ' characters' +
      (r.main.match ? ' &middot; matched' : ' &middot; no match') + '</div>');
    H.push('</div></section>');

    if (r.cls.kind === 'exponential' || r.cls.kind === 'polynomial') {
      const p30 = project(r.pts, r.cls, 30), p40 = project(r.pts, r.cls, 40), p50 = project(r.pts, r.cls, 50);
      H.push('<section><div class="card pad" style="border-color:var(--bad)">');
      H.push('<span class="badge bad">projection</span> <strong style="margin-left:6px">' +
        'How bad it gets with a longer string</strong>');
      H.push('<div class="tablewrap" style="margin-top:9px"><table><thead><tr>' +
        '<th>Input length</th><th>Estimated steps</th><th>At 50M steps/sec</th></tr></thead><tbody>');
      [[30, p30], [40, p40], [50, p50]].forEach(([n, s]) => {
        if (s === null) return;
        H.push('<tr><td>' + n + ' characters</td><td class="mono">' +
          (isFinite(s) ? (s > 1e15 ? s.toExponential(2) : fmt(Math.round(s))) : 'beyond counting') +
          '</td><td>' + esc(humanTime(s)) + '</td></tr>');
      });
      H.push('</tbody></table></div>');
      H.push('<p class="muted" style="margin:9px 0 0">Extrapolated from the measured growth rate of ' +
        r.cls.ratio.toFixed(2) + '× per character. The step counts on the chart are measured; ' +
        'these three rows are an estimate, and the real figure depends on the engine.</p>');
      H.push('</div></section>');
    }

    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Where the engine spent its time</h2>');
    H.push('<div class="card pad">' + heat(r.str, r.main.visits) +
      '<p class="muted" style="margin:10px 0 0">One bar per character, height is how many times the engine ' +
      'visited that position. A single red spike is the signature of catastrophic backtracking — the engine ' +
      'is trying every possible way to divide the text before it gives up.</p></div></section>');

    H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Steps against input length</h2>');
    H.push('<div class="card pad">' + chart(r.pts) +
      '<p class="muted" style="margin:8px 0 0">Logarithmic scale, one measured run per prefix length. ' +
      'A straight line here means exponential growth.</p></div></section>');

    if (r.fixes.length) {
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Defuse it</h2>');
      r.fixes.forEach((f, i) => {
        H.push('<div class="card pad" style="margin-bottom:8px">' +
          '<strong>' + esc(f.label) + '</strong>' +
          '<div class="mono" style="margin-top:6px;font-size:13px">' + esc(f.pattern) + '</div>' +
          '<div class="muted" style="margin-top:6px">' + esc(f.why) + '</div>' +
          '<button data-fix="' + i + '" style="margin-top:9px;font-size:12.5px">Run this instead</button></div>');
      });
      H.push('</section>');
    }

    H.push('<section><div class="row"><button id="cp">Copy the findings</button>' +
      '<button id="reset">Try another</button></div></section>');

    outEl.innerHTML = H.join('');
    outEl.hidden = false;

    Array.from(outEl.querySelectorAll('[data-fix]')).forEach(b => {
      b.onclick = () => { $('#pat').value = r.fixes[+b.dataset.fix].pattern; run(); };
    });
    $('#cp').onclick = () => copy(report(r), 'Findings copied');
    $('#reset').onclick = () => { outEl.hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' }); };
    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function report(r) {
    const L = ['Backtracking analysis', '', 'Pattern: ' + r.pattern,
      'Input:   ' + r.str.length + ' characters', ''];
    L.push('Steps: ' + (r.main.halted ? STEP_CAP + '+ (capped)' : r.main.steps));
    L.push('Growth: ' + r.cls.kind + ' (' + r.cls.ratio.toFixed(2) + 'x per character)');
    L.push('Result: ' + (r.main.match ? 'matched' : 'no match'));
    if (r.cls.kind === 'exponential') {
      const p40 = project(r.pts, r.cls, 40);
      if (p40) L.push('', 'At 40 characters this would take roughly ' + humanTime(p40) + '.');
    }
    L.push('', 'Measured steps by input length:');
    r.pts.forEach(p => L.push('  ' + String(p.n).padStart(3) + ' chars: ' +
      (p.halted ? 'capped' : p.steps + ' steps')));
    if (r.fixes.length) {
      L.push('', 'Suggested fixes:');
      r.fixes.forEach(f => L.push('  ' + f.label + ': ' + f.pattern));
    }
    L.push('', 'Measured with https://papercuts-mauve.vercel.app/regex-backtrack');
    return L.join('\n');
  }

  $('#run').onclick = run;
  $('#clear').onclick = () => {
    $('#pat').value = ''; $('#str').value = '';
    outEl.hidden = true; statusEl.innerHTML = ''; $('#pat').focus();
  };
  [$('#pat'), $('#str')].forEach(el => el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); run(); }
  }));
})();
