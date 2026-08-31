/* Invisible Character X-Ray — 100% client-side. */
(function () {
  'use strict';
  const { $, esc, toast, copy, download, fmt } = window.PC;

  const MAX_RENDER = 30000;

  /* cp -> [short, name, severity, category, why] */
  const CHARS = {
    0x00A0: ['NBSP', 'No-break space', 'warning', 'space', 'Looks exactly like a space but is a different character. Breaks split(" "), trimming, and every exact string match.'],
    0x00AD: ['SHY', 'Soft hyphen', 'critical', 'zero-width', 'Completely invisible until a line wraps. Copies silently out of PDFs and Word into identifiers and URLs.'],
    0x061C: ['ALM', 'Arabic letter mark', 'critical', 'bidi', 'Invisible bidirectional control character.'],
    0x180E: ['MVS', 'Mongolian vowel separator', 'critical', 'zero-width', 'Renders as zero width in modern fonts.'],
    0x200B: ['ZWSP', 'Zero-width space', 'critical', 'zero-width', 'Takes up no width at all. The single most common reason two identical-looking strings are not equal.'],
    0x200C: ['ZWNJ', 'Zero-width non-joiner', 'critical', 'zero-width', 'Invisible joining control character.'],
    0x200D: ['ZWJ', 'Zero-width joiner', 'critical', 'zero-width', 'Invisible joining control. Also what glues multi-part emoji together, so removing it can split them.'],
    0x200E: ['LRM', 'Left-to-right mark', 'critical', 'bidi', 'Invisible direction control, constantly pasted out of Word, Jira and Outlook.'],
    0x200F: ['RLM', 'Right-to-left mark', 'critical', 'bidi', 'Invisible direction control.'],
    0x2028: ['LS', 'Line separator', 'critical', 'control', 'A line break that many parsers mishandle and that used to break JSON.parse outright.'],
    0x2029: ['PS', 'Paragraph separator', 'critical', 'control', 'Same family as the line separator, same parser problems.'],
    0x202A: ['LRE', 'Left-to-right embedding', 'critical', 'bidi', 'Trojan Source (CVE-2021-42574): reorders how text is displayed without changing what it says.'],
    0x202B: ['RLE', 'Right-to-left embedding', 'critical', 'bidi', 'Trojan Source (CVE-2021-42574): reorders how text is displayed without changing what it says.'],
    0x202C: ['PDF', 'Pop directional formatting', 'critical', 'bidi', 'Closes a bidirectional override. Invisible.'],
    0x202D: ['LRO', 'Left-to-right override', 'critical', 'bidi', 'Trojan Source: forces display order, so a reviewer can read one thing and the compiler build another.'],
    0x202E: ['RLO', 'Right-to-left override', 'critical', 'bidi', 'Trojan Source: forces display order. Also the classic "exe disguised as txt" filename trick.'],
    0x202F: ['NNBSP', 'Narrow no-break space', 'warning', 'space', 'A narrower non-breaking space. Indistinguishable from a normal space at a glance.'],
    0x205F: ['MMSP', 'Medium mathematical space', 'warning', 'space', 'A maths-typesetting space that behaves nothing like a normal space.'],
    0x2060: ['WJ', 'Word joiner', 'critical', 'zero-width', 'Zero-width, invisible, and survives most copy-paste cleanups.'],
    0x2066: ['LRI', 'Left-to-right isolate', 'critical', 'bidi', 'Trojan Source isolate character.'],
    0x2067: ['RLI', 'Right-to-left isolate', 'critical', 'bidi', 'Trojan Source isolate character.'],
    0x2068: ['FSI', 'First strong isolate', 'critical', 'bidi', 'Trojan Source isolate character.'],
    0x2069: ['PDI', 'Pop directional isolate', 'critical', 'bidi', 'Closes a bidirectional isolate. Invisible.'],
    0x3000: ['IDSP', 'Ideographic space', 'warning', 'space', 'A full-width space from CJK input. Looks like two spaces, matches neither.'],
    0xFEFF: ['BOM', 'Zero-width no-break space (BOM)', 'critical', 'zero-width', 'A byte-order mark stranded inside the text. Breaks JSON parsing, shell scripts and CSV headers.'],
    0xFFFD: ['REPL', 'Replacement character', 'critical', 'control', 'Data that is already lost: an earlier step failed to decode a byte and substituted this.'],
    0x2018: ['LQUO', 'Left single quotation mark', 'info', 'punct', 'A curly quote where code, CSV or JSON expects a straight apostrophe.'],
    0x2019: ['RQUO', 'Right single quotation mark', 'info', 'punct', 'The smart apostrophe. Breaks string literals, SQL and diffs.'],
    0x201C: ['LDQUO', 'Left double quotation mark', 'info', 'punct', 'A curly double quote where a straight one is expected.'],
    0x201D: ['RDQUO', 'Right double quotation mark', 'info', 'punct', 'A curly double quote where a straight one is expected.'],
    0x2013: ['NDASH', 'En dash', 'info', 'punct', 'Autocorrect turns hyphens into these. Command-line flags and IDs stop working.'],
    0x2014: ['MDASH', 'Em dash', 'info', 'punct', 'Autocorrect turns double hyphens into these.'],
    0x2026: ['ELLIP', 'Horizontal ellipsis', 'info', 'punct', 'One character pretending to be three dots.'],
    0x00B4: ['ACUTE', 'Acute accent', 'info', 'punct', 'A standalone accent often typed instead of an apostrophe.'],
    0x2032: ['PRIME', 'Prime', 'info', 'punct', 'Often pasted in place of a straight apostrophe.'],
    0x2033: ['DPRIME', 'Double prime', 'info', 'punct', 'Often pasted in place of a straight double quote.']
  };

  const SPACES = {}; /* U+2000..U+200A assorted fixed-width spaces */
  for (let cp = 0x2000; cp <= 0x200A; cp++) {
    SPACES[cp] = ['SP', 'Fixed-width space U+' + cp.toString(16).toUpperCase(),
      'warning', 'space', 'A typographic space of a fixed width. Looks like a space, matches nothing.'];
  }

  const HOMO = {
    'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y','ѕ':'s','і':'i','ј':'j','һ':'h','ԛ':'q','ԝ':'w','ь':'b','ᴄ':'c',
    'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','Х':'X','У':'Y','Ѕ':'S','І':'I','Ј':'J',
    'ο':'o','Ο':'O','Α':'A','Β':'B','Ε':'E','Ζ':'Z','Η':'H','Ι':'I','Κ':'K','Μ':'M','Ν':'N','Ρ':'P','Τ':'T','Υ':'Y','Χ':'X',
    'α':'a','ρ':'p','τ':'t','ε':'e','ι':'i','κ':'k','ν':'v','ϲ':'c'
  };

  const CP1252 = {0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,
    0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,
    0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,
    0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};

  /* A character is "mojibake-encodable" if it could have come from a single
     Windows-1252 byte. Runs of such characters are candidates for re-decoding. */
  function toByte(ch) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x80 && cp <= 0xFF) return cp;
    if (CP1252[cp] !== undefined) return CP1252[cp];
    return -1;
  }

  function repairMojibake(s) {
    let out = "", run = "";
    const flush = () => {
      if (run) { const f = fixMojibake(run); out += (f !== null && f !== run) ? f : run; run = ""; }
    };
    for (const ch of s) {
      if (toByte(ch) >= 0) run += ch; else { flush(); out += ch; }
    }
    flush();
    return out;
  }

  function classify(cp, ch, allowHomo) {
    if (CHARS[cp]) return CHARS[cp];
    if (SPACES[cp]) return SPACES[cp];
    if (cp === 0x09 || cp === 0x0A || cp === 0x0D) return null;      /* normal whitespace */
    if (cp <= 0x08 || (cp >= 0x0B && cp <= 0x0C) || (cp >= 0x0E && cp <= 0x1F) || cp === 0x7F) {
      return ['CTRL', 'Control character U+' + cp.toString(16).toUpperCase().padStart(4, '0'),
        'critical', 'control', 'A raw control byte. Invisible, and it will break parsers, terminals and databases.'];
    }
    if (allowHomo && HOMO[ch]) {
      return ['HOMO', 'Lookalike letter (renders as "' + HOMO[ch] + '")', 'warning', 'homoglyph',
        'This is not the Latin letter it appears to be. It is how lookalike domains and typosquatted package names work, and it makes two identifiers that look identical behave as different names.'];
    }
    return null;
  }

  function fixMojibake(s) {
    const bytes = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp <= 0xFF) bytes.push(cp);
      else if (CP1252[cp] !== undefined) bytes.push(CP1252[cp]);
      else return null;
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); }
    catch (e) { return null; }
  }

  /* ------------------------------------------------------------- cleaning */
  const RE_INVIS_ALL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u00AD\\u061C' +
    '\\u180E\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF\\uFFFD]', 'g');
  const RE_SPACES_ALL = new RegExp('[\\u00A0\\u2000-\\u200A\\u202F\\u205F\\u3000]', 'g');

  function clean(text, o) {
    let s = text;
    if (o.mojibake) s = repairMojibake(s);
    if (o.invisible) s = s.replace(RE_INVIS_ALL, '');
    if (o.spaces) s = s.replace(RE_SPACES_ALL, ' ');
    if (o.punct) s = s
      .replace(/[‘’‛′´]/g, "'")
      .replace(/[“”‟″]/g, '"')
      .replace(/[–—−]/g, '-')
      .replace(/…/g, '...')
      .replace(/•/g, '*');
    if (o.homo) s = s.replace(/./gu, c => (HOMO[c] || c));
    if (o.nfc) { try { s = s.normalize('NFC'); } catch (e) { /* ignore */ } }
    if (o.tidy) s = s.split('\n').map(l => l.replace(/[ \t]+/g, ' ').replace(/[ \t]+$/g, '')).join('\n');
    return s;
  }

  /* -------------------------------------------------------------- scanner */
  function scan(text) {
    /* Only flag homoglyphs when the text is not genuinely Cyrillic/Greek. */
    let foreign = 0, letters = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp > 0x40) letters++;
      if ((cp >= 0x0400 && cp <= 0x04FF) || (cp >= 0x0370 && cp <= 0x03FF)) foreign++;
    }
    const allowHomo = !(letters > 0 && foreign / letters > 0.2);

    const found = [];              /* {i, ch, cp, meta} in document order */
    const kinds = Object.create(null);
    let total = 0, i = 0;
    for (const ch of text) {
      total++;
      const cp = ch.codePointAt(0);
      const meta = classify(cp, ch, allowHomo);
      if (meta) {
        found.push({ i: i, ch: ch, cp: cp, meta: meta });
        const k = meta[1];
        kinds[k] = kinds[k] || { short: meta[0], name: meta[1], sev: meta[2], cat: meta[3], why: meta[4], cp: cp, n: 0 };
        kinds[k].n++;
      }
      i += ch.length;
    }
    return { found: found, kinds: kinds, total: total, allowHomo: allowHomo,
      mojibake: repairMojibake(text) !== text };
  }

  /* --------------------------------------------------------------- render */
  const SEVRANK = { critical: 0, warning: 1, info: 2 };
  const BADGE = { critical: 'bad', warning: 'warn', info: 'neutral' };
  const outEl = $('#out'), statusEl = $('#status');
  let current = null;

  function hex(cp) { return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'); }

  function xray(text, found) {
    const slice = text.length > MAX_RENDER;
    const limit = slice ? MAX_RENDER : text.length;
    const marks = Object.create(null);
    found.forEach(f => { if (f.i < limit) marks[f.i] = f; });
    const h = [];
    let i = 0;
    while (i < limit) {
      const f = marks[i];
      if (f) {
        h.push('<span class="ch ' + f.meta[2] + '" title="' + esc(f.meta[1] + ' — ' + hex(f.cp)) + '">' +
          esc(f.meta[0]) + '</span>');
        i += f.ch.length;
      } else {
        let j = i;
        while (j < limit && !marks[j]) j++;
        h.push(esc(text.slice(i, j)));
        i = j;
      }
    }
    if (slice) h.push('<span class="muted">\n\n… showing the first ' + fmt(MAX_RENDER) +
      ' characters of ' + fmt(text.length) + '. Counts below cover the whole text.</span>');
    return h.join('');
  }

  function render(text, r) {
    const kinds = Object.keys(r.kinds).map(k => r.kinds[k])
      .sort((a, b) => (SEVRANK[a.sev] - SEVRANK[b.sev]) || (b.n - a.n));
    const critical = kinds.filter(k => k.sev === 'critical').reduce((s, k) => s + k.n, 0);
    const h = [];

    h.push('<section><div class="card pad" style="border-color:' +
      (r.found.length ? (critical ? 'var(--bad)' : 'var(--warn)') : 'var(--ok)') + '">');
    h.push('<h2 style="margin:0;font-size:19px">' +
      (r.found.length
        ? fmt(r.found.length) + ' suspicious character' + (r.found.length === 1 ? '' : 's') +
          ' across ' + kinds.length + ' kind' + (kinds.length === 1 ? '' : 's')
        : 'Clean. Nothing hiding in here.') + '</h2>');
    h.push('<div class="muted" style="margin-top:4px">' + fmt(r.total) + ' characters scanned' +
      (r.allowHomo ? '' : ' · lookalike-letter checking is off because this text is genuinely Cyrillic or Greek') + '</div>');
    h.push('</div></section>');

    if (r.mojibake) {
      h.push('<section><div class="card pad" style="border-color:var(--bad)">' +
        '<span class="badge bad">mojibake</span> <strong style="margin-left:6px">This text was decoded with the wrong character set</strong>' +
        '<div class="muted" style="margin-top:5px">Sequences like <code>Ã©</code> and <code>â€™</code> mean UTF-8 bytes were read as Windows-1252. ' +
        'Tick <em>Repair mojibake</em> below to decode it back.</div></div></section>');
    }

    if (r.found.length) {
      h.push('<section><div class="stats">');
      h.push('<div class="stat bad"><b>' + fmt(critical) + '</b><span>critical</span></div>');
      h.push('<div class="stat warn"><b>' + fmt(kinds.filter(k => k.sev === 'warning').reduce((s, k) => s + k.n, 0)) + '</b><span>suspicious</span></div>');
      h.push('<div class="stat"><b>' + fmt(kinds.filter(k => k.sev === 'info').reduce((s, k) => s + k.n, 0)) + '</b><span>cosmetic</span></div>');
      h.push('<div class="stat"><b>' + fmt(r.total) + '</b><span>characters</span></div>');
      h.push('</div></section>');

      h.push('<section><h2 style="font-size:17px;margin:0 0 9px">X-ray</h2>');
      h.push('<div class="xray">' + xray(text, r.found) + '</div>');
      h.push('<p class="muted" style="margin:8px 0 0">Every chip is one character that is not what it looks like. Hover for its Unicode name.</p></section>');

      h.push('<section><h2 style="font-size:17px;margin:0 0 9px">What is in here</h2><div class="tablewrap"><table>');
      h.push('<thead><tr><th>Count</th><th>Character</th><th>Code point</th><th>Why it matters</th></tr></thead><tbody>');
      kinds.forEach(k => {
        h.push('<tr><td class="mono">' + fmt(k.n) + '</td>' +
          '<td><span class="badge ' + BADGE[k.sev] + '">' + esc(k.short) + '</span><div style="margin-top:3px">' + esc(k.name) + '</div></td>' +
          '<td class="mono">' + hex(k.cp) + '</td>' +
          '<td class="muted">' + esc(k.why) + '</td></tr>');
      });
      h.push('</tbody></table></div></section>');
    }

    /* cleaning options */
    h.push('<section><h2 style="font-size:17px;margin:0 0 9px">Clean it</h2><div class="card pad"><div class="opts">');
    const opts = [
      ['invisible', 'Remove invisible characters', 'Zero-width, control and bidirectional characters, deleted outright.', true],
      ['spaces', 'Normalise exotic spaces', 'Non-breaking and typographic spaces become ordinary spaces.', true],
      ['punct', 'Straighten quotes and dashes', 'Curly quotes, en/em dashes and ellipses become ASCII.', false],
      ['homo', 'Replace lookalike letters', 'Cyrillic and Greek lookalikes become their Latin equivalents.', false],
      ['nfc', 'Normalise Unicode (NFC)', 'Combines accents into single code points so comparisons line up.', false],
      ['tidy', 'Collapse repeated and trailing spaces', 'Tidies each line without touching line breaks.', false]
    ];
    if (r.mojibake) opts.unshift(['mojibake', 'Repair mojibake', 'Re-decode the text as UTF-8 to recover the original characters.', true]);
    opts.forEach(o => {
      h.push('<label class="opt"><input type="checkbox" data-opt="' + o[0] + '"' + (o[3] ? ' checked' : '') + '>' +
        '<span><b>' + esc(o[1]) + '</b><span>' + esc(o[2]) + '</span></span></label>');
    });
    h.push('</div></div>');
    h.push('<div style="margin-top:11px"><label for="output">Cleaned text</label>' +
      '<textarea id="output" readonly spellcheck="false" style="margin-top:6px;min-height:130px"></textarea></div>');
    h.push('<div class="row" style="margin-top:9px">' +
      '<button class="primary" id="cp-out">Copy cleaned text</button>' +
      '<button id="dl-out">Download as .txt</button>' +
      '<span class="muted grow" style="text-align:right" id="delta"></span></div></section>');

    outEl.innerHTML = h.join('');
    outEl.hidden = false;
    statusEl.innerHTML = '';

    const boxes = Array.from(outEl.querySelectorAll('input[data-opt]'));
    const output = $('#output');
    function refresh() {
      const o = {};
      boxes.forEach(b => { o[b.dataset.opt] = b.checked; });
      const cleaned = clean(text, o);
      output.value = cleaned;
      const removed = r.found.length - scan(cleaned).found.length;
      $('#delta').textContent = removed > 0
        ? fmt(removed) + ' character' + (removed === 1 ? '' : 's') + ' fixed'
        : 'No changes with these options';
    }
    boxes.forEach(b => b.addEventListener('change', refresh));
    refresh();

    $('#cp-out').onclick = () => copy(output.value, 'Cleaned text copied');
    $('#dl-out').onclick = () => download('cleaned.txt', output.value, 'text/plain;charset=utf-8');

    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* Exposed for tests and console poking. */
  window.PapercutsXray = { scan, clean, repairMojibake, classify, fixMojibake };

  /* ------------------------------------------------------------- handlers */
  if (!document.getElementById('input')) return;   /* headless / test context */

  const input = $('#input');

  function run() {
    const text = input.value;
    if (!text) {
      statusEl.innerHTML = '<section><div class="err">Paste some text first — or hit “Try a haunted sample”.</div></section>';
      outEl.hidden = true;
      return;
    }
    if (text.length > 2000000) {
      statusEl.innerHTML = '<section><div class="err">That is over 2 million characters. Paste a smaller chunk so the tab stays responsive.</div></section>';
      return;
    }
    statusEl.innerHTML = '';
    current = scan(text);
    render(text, current);
  }

  $('#scan').onclick = run;
  $('#clear').onclick = () => {
    input.value = ''; outEl.hidden = true; outEl.innerHTML = '';
    statusEl.innerHTML = ''; count(); input.focus();
  };

  function count() {
    const n = input.value.length;
    $('#charcount').textContent = n ? fmt(n) + ' characters' : '';
  }
  input.addEventListener('input', count);
  input.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  /* Every invisible character below is written as an escape so the sample is
     exactly what it claims to be, whatever an editor does to this file. */
  const ZWSP = "\u200B", ZWNJ = "\u200C", RLO = "\u202E", PDF_ = "\u202C",
        NBSP = "\u00A0", IDSP = "\u3000", BOM = "\uFEFF", SHY = "\u00AD";
  const SAMPLE =
    'const total' + ZWSP + ' = price + tax;\n' +
    'if (user.name === "\u0410dmin") {' + NBSP + NBSP + '// that A is Cyrillic\n' +
    '  console.log(\u2018unreachable\u2019);\n' +
    '}\n\n' +
    'Invoice #' + ZWNJ + '4402 \u2014 due 30\u2013days \u2026\n' +
    'Client: Caf\u00C3\u00A9 M\u00C3\u00BCller GmbH\n' +
    'Note: ' + RLO + 'gnp.eciovni' + PDF_ + '\n' +
    'Amount: 1,250.00' + IDSP + 'EUR' + BOM + '\n' +
    'Sig' + SHY + 'nature required\n';

  $('#sample').onclick = () => { input.value = SAMPLE; count(); run(); };

  count();
})();
