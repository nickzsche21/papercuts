/* Will Excel break my CSV? — 100% client-side analysis engine. */
(function () {
  'use strict';
  const { $, esc, toast, copy, download, dropzone, fmt, bytes, colName } = window.PC;

  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_FINDINGS = 20000;
  const SHOW_FINDINGS = 400;

  const MON = { JAN:1,JANUARY:1,FEB:2,FEBRUARY:2,MAR:3,MARCH:3,APR:4,APRIL:4,MAY:5,
    JUN:6,JUNE:6,JUL:7,JULY:7,AUG:8,AUGUST:8,SEP:9,SEPT:9,SEPTEMBER:9,
    OCT:10,OCTOBER:10,NOV:11,NOVEMBER:11,DEC:12,DECEMBER:12 };
  const MON_SHORT = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const RE_PLAIN_NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  const RE_SIMPLE    = /^[+-]?[1-9]\d{0,10}(\.\d{1,9})?$/;   /* safe fast-path number */

  /* Invisible / control / bidi / exotic-space characters, built from escapes
     so this source file stays free of literal control characters. */
  const INVIS_SRC = '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u00A0\\u00AD' +
                    '\\u1680\\u180E\\u2000-\\u200F\\u2028\\u2029\\u202A-\\u202F' +
                    '\\u205F\\u2060\\u2066-\\u2069\\u3000\\uFEFF]';
  const RE_INVIS  = new RegExp(INVIS_SRC);
  const RE_INVISG = new RegExp(INVIS_SRC, 'g');
  const BOM = '﻿';

  /* ---------------------------------------------------------------- rules */
  /* Returns the single most severe problem for a cell, or null. */
  function analyzeCell(v) {
    if (!v) return null;
    if (RE_SIMPLE.test(v)) return null;                     /* fast path */

    const t = v.trim();

    /* 1. precision loss — irreversible */
    if (/^[+-]?\d{16,}$/.test(t)) {
      const sign = /^-/.test(t) ? '-' : '';
      const d = t.replace(/^[+-]/, '');
      return { id: 'precision', sev: 'critical', label: 'Precision loss (over 15 digits)',
        becomes: sign + d.slice(0, 15) + '0'.repeat(d.length - 15),
        why: 'Excel stores only 15 significant digits. Digits past the 15th are replaced with zeros and cannot be recovered.' };
    }

    /* 2. formula / CSV injection */
    if (/^\s*[=@]/.test(v) || (/^\s*[+\-]/.test(v) && !RE_PLAIN_NUM.test(t))) {
      return { id: 'formula', sev: 'critical', label: 'Executed as a formula',
        becomes: /^\s*[+\-]/.test(v) ? '#NAME?' : 'formula result (or #NAME?)',
        why: 'Excel evaluates any cell starting with = + - or @. Phone numbers like +44 20 7946 0958 become #NAME?, and a crafted cell can run commands (CWE-1236 CSV injection).' };
    }

    /* 3. gene / word+digit date coercion: SEPT1, MARCH1, DEC1 */
    let m = /^([A-Za-z]{3,9})[-\s]?(\d{1,2})$/.exec(t);
    if (m && MON[m[1].toUpperCase()] && +m[2] >= 1 && +m[2] <= 31) {
      return { id: 'date-word', sev: 'critical', label: 'Turned into a date',
        becomes: m[2] + '-' + MON_SHORT[MON[m[1].toUpperCase()]],
        why: 'Excel reads a month name followed by a number as a date. This is the bug that forced the HUGO committee to rename human genes.' };
    }
    m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})$/.exec(t);
    if (m && MON[m[2].toUpperCase()]) {
      return { id: 'date-word', sev: 'critical', label: 'Turned into a date',
        becomes: m[1] + '-' + MON_SHORT[MON[m[2].toUpperCase()]],
        why: 'Excel reads this as a day-and-month date and stores a serial number, not your text.' };
    }

    /* 4. bare n/n or n-n becomes a date */
    m = /^(\d{1,2})[\/\-](\d{1,2})$/.exec(t);
    if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
      return { id: 'date-short', sev: 'critical', label: 'Turned into a date',
        becomes: m[2] + '-' + MON_SHORT[+m[1]],
        why: 'Excel reads two numbers separated by / or - as month/day. Fractions and version numbers are destroyed this way.' };
    }

    /* 5. leading zero */
    if (/^0\d+$/.test(t)) {
      return { id: 'leading-zero', sev: 'critical', label: 'Leading zero stripped',
        becomes: String(Number(t)),
        why: 'Excel reads it as a number, so the leading zero disappears. Breaks ZIP codes, phone numbers, SKUs and account numbers.' };
    }

    /* 6. exponent-looking string: 1E5, 2E10 */
    if (/^\d+[eE][+-]?\d+$/.test(t)) {
      return { id: 'exponent', sev: 'critical', label: 'Read as scientific notation',
        becomes: String(Number(t)),
        why: 'Excel treats this as a number in exponential form. Product codes and gene names like 2E10 are silently converted.' };
    }

    /* 7. long digit runs shown as scientific notation */
    if (/^[+-]?\d{12,15}$/.test(t)) {
      return { id: 'scientific', sev: 'critical', label: 'Displayed as scientific notation',
        becomes: Number(t).toExponential(5).replace('e', 'E').toUpperCase(),
        why: 'In the General format Excel switches to scientific notation past 11 digits. Barcodes, IMEIs and order IDs become unreadable and copy out wrong.' };
    }

    /* 8. full date — ambiguous day/month order */
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(t);
    if (m && +m[1] <= 31 && +m[2] <= 31) {
      const amb = +m[1] <= 12 && +m[2] <= 12 && +m[1] !== +m[2];
      return { id: 'date-ambiguous', sev: amb ? 'warning' : 'info',
        label: amb ? 'Ambiguous date order' : 'Converted to a date serial',
        becomes: amb ? (MON_SHORT[+m[1]] + ' ' + m[2] + ' in the US, ' + MON_SHORT[+m[2]] + ' ' + m[1] + ' in the EU')
                     : 'date serial number',
        why: amb ? 'Excel applies the reader locale. The same file means two different dates on two different machines.'
                 : 'Stored as a serial number, so the original text formatting is lost.' };
    }

    /* 9. time */
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) {
      return { id: 'time', sev: 'warning', label: 'Converted to a time value',
        becomes: 'time serial (' + t + ')',
        why: 'Durations like 26:15 wrap around, and the value becomes a fraction of a day rather than text.' };
    }

    /* 10. thousands separators */
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) {
      return { id: 'thousands', sev: 'warning', label: 'Separators stripped',
        becomes: t.replace(/,/g, ''),
        why: 'Excel parses it as a number and drops your formatting, and in locales that use a comma decimal separator it can change the value.' };
    }

    /* 11. error literals */
    if (/^#(REF|N\/A|VALUE|DIV\/0|NAME|NULL|NUM)[!?]?$/i.test(t)) {
      return { id: 'error-literal', sev: 'warning', label: 'Becomes a real Excel error',
        becomes: t.toUpperCase(),
        why: 'Excel converts the text into an actual error value, so filters and formulas downstream break.' };
    }

    /* 12. boolean */
    if (/^(TRUE|FALSE)$/i.test(t)) {
      return { id: 'boolean', sev: 'info', label: 'Converted to a boolean',
        becomes: t.toUpperCase(),
        why: 'The text becomes a logical value, so casing and any exact string match downstream changes.' };
    }

    /* 13. invisible characters */
    if (RE_INVIS.test(v)) {
      return { id: 'invisible', sev: 'warning', label: 'Contains invisible characters',
        becomes: v.replace(RE_INVISG, '␣'),
        why: 'Non-breaking spaces, zero-width characters or control codes hide inside the value and break lookups, joins and exact matches.' };
    }

    /* 14. stray whitespace */
    if (v !== t && t !== '') {
      return { id: 'whitespace', sev: 'info', label: 'Leading or trailing whitespace',
        becomes: '"' + t + '" after trimming',
        why: 'VLOOKUP, joins and de-duplication treat " Acme" and "Acme" as different values.' };
    }

    /* 15. oversized text */
    if (v.length > 32767) {
      return { id: 'too-long', sev: 'critical', label: 'Truncated (over 32,767 chars)',
        becomes: v.slice(0, 40) + '... (cut at 32,767)',
        why: 'A single Excel cell cannot hold more than 32,767 characters. The rest is discarded on open.' };
    }
    return null;
  }

  /* Cells worth wrapping as ="..." in the Excel-safe export */
  const WRAP = new Set(['precision','formula','date-word','date-short','leading-zero',
    'exponent','scientific','date-ambiguous','time','thousands','error-literal','boolean']);

  /* --------------------------------------------------------------- parser */
  function detectDelimiter(text) {
    const head = text.slice(0, 20000);
    const lines = head.split(/\r?\n/).filter(l => l.trim()).slice(0, 5);
    let best = ',', bestScore = -1;
    for (const d of [',', ';', '\t', '|']) {
      const counts = lines.map(l => {
        let n = 0, q = false;
        for (let i = 0; i < l.length; i++) {
          const c = l[i];
          if (c === '"') q = !q;
          else if (c === d && !q) n++;
        }
        return n;
      });
      if (!counts.length || counts[0] === 0) continue;
      const consistent = counts.every(c => c === counts[0]);
      const score = counts[0] * (consistent ? 10 : 1);
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  function parseCSV(text, delim) {
    const rows = [];
    let row = [], field = '', inQ = false, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { if (text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function serialize(rows, delim, mode) {
    const out = [];
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r];
      const line = [];
      for (let c = 0; c < cells.length; c++) {
        let v = cells[c];
        const f = r === 0 ? null : analyzeCell(v);
        if (mode === 'excel' && f && WRAP.has(f.id)) {
          line.push('="' + v.replace(/"/g, '""') + '"');
          continue;
        }
        if (mode === 'clean') {
          v = v.replace(RE_INVISG, '').trim();
          if (/^\s*[=+\-@]/.test(v) && !RE_PLAIN_NUM.test(v)) v = "'" + v;
        }
        line.push('"' + v.replace(/"/g, '""') + '"');
      }
      out.push(line.join(delim));
    }
    return BOM + out.join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------------------------ run */
  let state = null;
  const statusEl = $('#status'), outEl = $('#out');

  function setStatus(html) { statusEl.innerHTML = html ? '<section>' + html + '</section>' : ''; }

  function analyze(text, name, size) {
    const hadBOM = text.charCodeAt(0) === 0xFEFF;
    if (hadBOM) text = text.slice(1);
    const delim = detectDelimiter(text);
    const rows = parseCSV(text, delim);
    if (!rows.length) { setStatus('<div class="err">That file has no rows in it.</div>'); return; }

    const header = rows[0];
    const nCols = header.length;
    const findings = [];
    const byCol = new Array(nCols).fill(0);
    const byRule = Object.create(null);
    let cells = 0, critical = 0, warning = 0, info = 0, capped = false;
    const ragged = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length !== nCols && !(row.length === 1 && row[0] === '')) {
        if (ragged.length < 20) ragged.push({ row: r + 1, got: row.length });
      }
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (v === '') continue;
        cells++;
        const f = analyzeCell(v);
        if (!f) continue;
        if (f.sev === 'critical') critical++; else if (f.sev === 'warning') warning++; else info++;
        if (c < nCols) byCol[c]++;
        byRule[f.id] = byRule[f.id] || { label: f.label, sev: f.sev, n: 0 };
        byRule[f.id].n++;
        if (findings.length < MAX_FINDINGS) {
          findings.push({ ref: colName(c) + (r + 1), col: header[c] || colName(c), value: v, f: f });
        } else capped = true;
      }
    }

    /* file-level checks */
    const fileIssues = [];
    const nonAscii = /[^\x00-\x7F]/.test(text);
    if (nonAscii && !hadBOM) fileIssues.push({
      sev: 'critical', label: 'No UTF-8 byte-order mark',
      why: 'The file contains accented or non-Latin characters but has no BOM. Double-clicking it in Excel on Windows shows mojibake such as A-tilde sequences instead of the real characters.' });
    if (ragged.length) fileIssues.push({
      sev: 'warning', label: ragged.length + ' row' + (ragged.length === 1 ? '' : 's') + ' with the wrong number of columns',
      why: 'Header has ' + nCols + ' columns; row' + (ragged.length === 1 ? ' ' : 's ') +
        ragged.slice(0, 6).map(x => x.row + ' has ' + x.got).join(', ') + (ragged.length > 6 ? ', and more' : '') +
        '. Most importers silently drop or shift these.' });
    const seen = Object.create(null), dupes = [];
    header.forEach(function (h) {
      const k = h.trim().toLowerCase();
      if (k) { if (seen[k] && dupes.indexOf(h) < 0) dupes.push(h); seen[k] = 1; }
    });
    if (dupes.length) fileIssues.push({
      sev: 'warning', label: 'Duplicate column headers: ' + dupes.join(', '),
      why: 'Pandas, SQL importers and Power Query will rename or overwrite one of them, usually without telling you.' });
    if (header.some(h => RE_INVIS.test(h) || h !== h.trim())) fileIssues.push({
      sev: 'warning', label: 'Header row has invisible characters or stray spaces',
      why: 'Column lookups by name will fail on the receiving end for no visible reason.' });

    state = { rows: rows, delim: delim, name: name };
    render({ name: name, size: size, rows: rows.length - 1, nCols: nCols, cells: cells,
      findings: findings, byCol: byCol, byRule: byRule, critical: critical, warning: warning,
      info: info, header: header, fileIssues: fileIssues, capped: capped, delim: delim, hadBOM: hadBOM });
  }

  /* --------------------------------------------------------------- render */
  const SEVRANK = { critical: 0, warning: 1, info: 2 };
  const BADGE = { critical: 'bad', warning: 'warn', info: 'neutral' };
  const DELIMNAME = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };

  function stat(v, l, cls) {
    return '<div class="stat ' + (cls || '') + '"><b>' + v + '</b><span>' + l + '</span></div>';
  }

  function render(a) {
    const total = a.critical + a.warning + a.info + a.fileIssues.length;
    const clean = total === 0;
    const h = [];

    h.push('<section><div class="card pad" style="border-color:' +
      (clean ? 'var(--ok)' : a.critical ? 'var(--bad)' : 'var(--warn)') + '">');
    h.push('<h2 style="margin:0 0 4px;font-size:19px">' +
      (clean ? 'This CSV survives Excel.'
        : a.critical ? fmt(a.critical) + ' cell' + (a.critical === 1 ? '' : 's') + ' will be silently destroyed'
        : fmt(total) + ' thing' + (total === 1 ? '' : 's') + ' will change') + '</h2>');
    h.push('<div class="muted">' + esc(a.name) + ' &middot; ' + bytes(a.size) + ' &middot; ' +
      fmt(a.rows) + ' rows &times; ' + a.nCols + ' columns &middot; ' + DELIMNAME[a.delim] + '-separated</div>');
    h.push('</div></section>');

    h.push('<section><div class="stats">');
    h.push(stat(fmt(a.cells), 'cells scanned', ''));
    h.push(stat(fmt(a.critical), 'will be destroyed', a.critical ? 'bad' : 'ok'));
    h.push(stat(fmt(a.warning), 'will change', a.warning ? 'warn' : 'ok'));
    h.push(stat(fmt(a.fileIssues.length), 'file-level issues', a.fileIssues.length ? 'warn' : 'ok'));
    h.push('</div></section>');

    h.push('<section><div class="row">');
    h.push('<button class="primary" id="dl-excel">Download Excel-safe CSV</button>');
    h.push('<button id="dl-clean">Download sanitised CSV</button>');
    if (!clean) h.push('<button id="cp-report">Copy report to send back</button>');
    h.push('<button id="reset">Scan another file</button>');
    h.push('</div><p class="muted" style="margin:9px 0 0">Excel-safe wraps flagged cells as <code>="value"</code> so Excel shows them verbatim. Sanitised strips invisible characters, trims whitespace and defuses formula cells for scripts and databases. Both add a UTF-8 BOM.</p></section>');

    if (a.fileIssues.length) {
      h.push('<section><h2 style="font-size:17px;margin:0 0 9px">Whole-file problems</h2>');
      a.fileIssues.forEach(function (fi) {
        h.push('<div class="card pad" style="margin-bottom:8px"><span class="badge ' + BADGE[fi.sev] + '">' +
          fi.sev + '</span> <strong style="margin-left:6px">' + esc(fi.label) + '</strong>' +
          '<div class="muted" style="margin-top:5px">' + esc(fi.why) + '</div></div>');
      });
      h.push('</section>');
    }

    const cols = a.byCol.map((n, i) => ({ n: n, i: i })).filter(x => x.n > 0)
      .sort((x, y) => y.n - x.n).slice(0, 8);
    if (cols.length) {
      h.push('<section><h2 style="font-size:17px;margin:0 0 9px">Worst columns</h2><div class="tablewrap"><table>');
      h.push('<thead><tr><th>Column</th><th>Cells at risk</th><th>Share of rows</th></tr></thead><tbody>');
      cols.forEach(function (x) {
        const pct = a.rows ? Math.round(x.n / a.rows * 100) : 0;
        h.push('<tr><td><code>' + esc(a.header[x.i] || colName(x.i)) + '</code> <span class="muted">(' +
          colName(x.i) + ')</span></td><td>' + fmt(x.n) + '</td><td>' + pct + '%</td></tr>');
      });
      h.push('</tbody></table></div></section>');
    }

    if (a.findings.length) {
      const sorted = a.findings.slice().sort((x, y) => SEVRANK[x.f.sev] - SEVRANK[y.f.sev]);
      const show = sorted.slice(0, SHOW_FINDINGS);
      h.push('<section><h2 style="font-size:17px;margin:0 0 9px">Every cell Excel changes' +
        (sorted.length > SHOW_FINDINGS ? ' <span class="muted" style="font-weight:400;font-size:13px">&mdash; showing the first ' +
          fmt(SHOW_FINDINGS) + ' of ' + fmt(sorted.length) + (a.capped ? '+' : '') + '</span>' : '') + '</h2>');
      h.push('<div class="tablewrap" style="max-height:560px;overflow-y:auto"><table><thead><tr>' +
        '<th>Cell</th><th>Column</th><th>Your value</th><th>Excel shows</th><th>What happens</th></tr></thead><tbody>');
      show.forEach(function (x) {
        h.push('<tr><td class="mono">' + x.ref + '</td><td>' + esc(String(x.col).slice(0, 32)) + '</td>' +
          '<td class="mono">' + esc(x.value.slice(0, 60)) + (x.value.length > 60 ? '&hellip;' : '') + '</td>' +
          '<td class="mono" style="color:var(--bad)">' + esc(String(x.f.becomes).slice(0, 60)) + '</td>' +
          '<td><span class="badge ' + BADGE[x.f.sev] + '">' + esc(x.f.label) + '</span>' +
          '<div class="muted" style="margin-top:3px;font-size:12.5px">' + esc(x.f.why) + '</div></td></tr>');
      });
      h.push('</tbody></table></div></section>');
    } else if (clean) {
      h.push('<section><div class="note">Nothing here will change when this file is opened in Excel or Google Sheets. ' +
        'It has a byte-order mark or is pure ASCII, every row has the same number of columns, and no cell looks like a date, a formula or an oversized number.</div></section>');
    }

    outEl.innerHTML = h.join('');
    outEl.hidden = false;
    setStatus('');

    $('#dl-excel').onclick = () => download(
      state.name.replace(/\.[^.]+$/, '') + '.excel-safe.csv',
      serialize(state.rows, state.delim, 'excel'), 'text/csv;charset=utf-8');
    $('#dl-clean').onclick = () => download(
      state.name.replace(/\.[^.]+$/, '') + '.sanitised.csv',
      serialize(state.rows, state.delim, 'clean'), 'text/csv;charset=utf-8');
    const cp = $('#cp-report');
    if (cp) cp.onclick = () => copy(report(a), 'Report copied - paste it in your reply');
    $('#reset').onclick = function () {
      outEl.hidden = true; outEl.innerHTML = ''; state = null;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function report(a) {
    const L = [];
    L.push('Heads up - ' + a.name + ' does not survive being opened in Excel.');
    L.push('');
    L.push('Scanned ' + fmt(a.rows) + ' rows x ' + a.nCols + ' columns (' + fmt(a.cells) + ' non-empty cells).');
    L.push(fmt(a.critical) + ' cells will be silently and irreversibly changed, ' + fmt(a.warning) + ' more will change visibly.');
    L.push('');
    L.push('What goes wrong:');
    Object.keys(a.byRule).sort((x, y) => a.byRule[y].n - a.byRule[x].n).forEach(function (k) {
      L.push('  - ' + a.byRule[k].label + ': ' + fmt(a.byRule[k].n) + ' cells');
    });
    a.fileIssues.forEach(fi => L.push('  - ' + fi.label));
    L.push('');
    const ex = a.findings.slice().sort((x, y) => SEVRANK[x.f.sev] - SEVRANK[y.f.sev]).slice(0, 8);
    if (ex.length) {
      L.push('Examples:');
      ex.forEach(x => L.push('  ' + x.ref + '  "' + x.value.slice(0, 40) + '"  ->  ' + x.f.becomes));
      L.push('');
    }
    L.push('Could you re-export with those columns forced to text, or send it as .xlsx?');
    L.push('');
    L.push('(Checked with https://papercuts-mauve.vercel.app/csv-excel-guard - runs entirely in the browser.)');
    return L.join('\n');
  }

  /* Exposed for tests and for anyone poking at the console. */
  window.PapercutsCSV = { analyzeCell, parseCSV, detectDelimiter, serialize };

  /* ------------------------------------------------------------- handlers */
  if (!document.getElementById('drop')) return;   /* headless / test context */

  function handleFile(file) {
    if (file.size > MAX_BYTES) {
      setStatus('<div class="err">That file is ' + bytes(file.size) +
        '. This tool caps at 20 MB so your browser tab stays alive - try splitting it, or paste a sample of the rows.</div>');
      return;
    }
    setStatus('<div class="card pad row"><span class="spin"></span> <span>Reading ' + esc(file.name) + '&hellip;</span></div>');
    const fr = new FileReader();
    fr.onerror = () => setStatus('<div class="err">Could not read that file. It may be locked by another program.</div>');
    fr.onload = function () {
      setTimeout(function () {
        try { analyze(String(fr.result), file.name, file.size); }
        catch (e) { setStatus('<div class="err">Could not parse that as a CSV: ' + esc(e.message) + '</div>'); }
      }, 20);
    };
    fr.readAsText(file, 'utf-8');
  }

  dropzone($('#drop'), $('#file'), handleFile);

  $('#paste-toggle').onclick = function () {
    const b = $('#paste-box');
    b.hidden = !b.hidden;
    if (!b.hidden) $('#paste').focus();
  };
  $('#scan-paste').onclick = function () {
    const v = $('#paste').value;
    if (!v.trim()) { toast('Paste some CSV text first'); return; }
    try { analyze(v, 'pasted.csv', new Blob([v]).size); }
    catch (e) { setStatus('<div class="err">Could not parse that: ' + esc(e.message) + '</div>'); }
  };

  const ZWSP = '​';
  const SAMPLE =
    'employee_id,gene,zip,phone,barcode,ratio,note,start_date\n' +
    '0001,SEPT1,02134,+44 20 7946 0958,4006381333931,3/4,ok,03/04/2026\n' +
    '0002,MARCH1,00501,+1 (415) 555-0142,9780306406157,1/2,=1+1,12/05/2026\n' +
    '0003,DEC1,90210,0917 555 0199,1234567890123456789,2/3,@SUM(A1:A9),01/02/2026\n' +
    '0004,OCT4,07030,+91 98765 43210,5901234123457,5/8,"café, naïve",15/06/2026\n' +
    '0005,2E10,00000,+81 3-1234-5678,123456789012,7/8,"  Acme' + ZWSP + ' Corp  ",30/07/2026\n' +
    '0006,MAY7,10001,+49 30 901820,4012345678901,1:30,TRUE,#N/A\n';

  $('#sample').onclick = () => analyze(SAMPLE, 'cursed-sample.csv', new Blob([SAMPLE]).size);
})();
