/* Nested JSON to CSV — 100% client-side. */
(function () {
  'use strict';
  const { $, esc, toast, copy, download, fmt, bytes } = window.PC;

  const MAX_ROWS = 200000;
  const PREVIEW_ROWS = 40;
  const BOM = '﻿';

  /* ---------------------------------------------------------------- parse */
  function parseInput(text) {
    const t = text.trim();
    if (!t) throw new Error('Nothing to convert.');
    try {
      return { data: JSON.parse(t), ndjson: false };
    } catch (firstErr) {
      /* Fall back to newline-delimited JSON. */
      const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 1) {
        const rows = [];
        for (let i = 0; i < lines.length; i++) {
          try { rows.push(JSON.parse(lines[i])); }
          catch (e) {
            throw new Error('Not valid JSON, and line ' + (i + 1) +
              ' is not valid NDJSON either: ' + e.message);
          }
        }
        return { data: rows, ndjson: true };
      }
      throw new Error(firstErr.message);
    }
  }

  const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  /* Find every array-of-records in the tree, biggest first. */
  function findArrays(data) {
    const out = [];
    if (Array.isArray(data)) out.push({ path: '(top level)', arr: data });
    (function walk(node, path, depth) {
      if (depth > 5 || !node || typeof node !== 'object') return;
      const keys = Array.isArray(node) ? [] : Object.keys(node);
      for (const k of keys) {
        const v = node[k];
        const p = path ? path + '.' + k : k;
        if (Array.isArray(v) && v.length && v.some(isRecord)) out.push({ path: p, arr: v });
        else if (isRecord(v)) walk(v, p, depth + 1);
      }
    })(data, '', 0);
    out.sort((a, b) => b.arr.length - a.arr.length);
    if (!out.length) out.push({ path: '(single record)', arr: [data] });
    return out;
  }

  /* -------------------------------------------------------------- flatten */
  function cross(a, b) {
    const out = [];
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        out.push(Object.assign({}, a[i], b[j]));
        if (out.length >= MAX_ROWS) return out;
      }
    }
    return out;
  }

  const scalar = v => (v === null || v === undefined) ? ''
    : (typeof v === 'boolean' ? String(v) : v);

  /* Returns an array of partial flat rows. */
  function expand(value, prefix, mode) {
    if (value === null || value === undefined) {
      const r = {}; r[prefix] = ''; return [r];
    }
    if (Array.isArray(value)) {
      if (!value.length) { const r = {}; r[prefix] = ''; return [r]; }
      if (mode === 'join') {
        const r = {};
        r[prefix] = value.map(v => (v !== null && typeof v === 'object')
          ? JSON.stringify(v) : String(scalar(v))).join('; ');
        return [r];
      }
      if (mode === 'index') {
        let rows = [{}];
        for (let i = 0; i < value.length; i++) rows = cross(rows, expand(value[i], prefix + '.' + i, mode));
        return rows;
      }
      let out = [];                                   /* explode */
      for (let i = 0; i < value.length; i++) {
        out = out.concat(expand(value[i], prefix, mode));
        if (out.length >= MAX_ROWS) break;
      }
      return out;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (!keys.length) { const r = {}; r[prefix] = ''; return [r]; }
      let rows = [{}];
      for (const k of keys) rows = cross(rows, expand(value[k], prefix ? prefix + '.' + k : k, mode));
      return rows;
    }
    const r = {}; r[prefix] = scalar(value); return [r];
  }

  function flatten(records, mode) {
    const rows = [];
    const cols = [];
    const seen = Object.create(null);
    let truncated = false;
    for (const rec of records) {
      const parts = expand(rec, isRecord(rec) || Array.isArray(rec) ? '' : 'value', mode);
      for (const p of parts) {
        for (const k in p) if (!seen[k]) { seen[k] = 1; cols.push(k); }
        rows.push(p);
        if (rows.length >= MAX_ROWS) { truncated = true; break; }
      }
      if (truncated) break;
    }
    return { rows: rows, cols: cols, truncated: truncated };
  }

  function toCSV(rows, cols) {
    const q = v => '"' + String(v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const out = [cols.map(q).join(',')];
    for (const r of rows) out.push(cols.map(c => q(r[c])).join(','));
    return BOM + out.join('\r\n') + '\r\n';
  }

  /* --------------------------------------------------------------- render */
  const statusEl = $('#status'), outEl = $('#out');
  let state = null;

  function err(msg) {
    statusEl.innerHTML = '<section><div class="err">' + esc(msg) + '</div></section>';
    outEl.hidden = true;
  }

  function convert() {
    const text = $('#input').value;
    statusEl.innerHTML = '';
    let parsed;
    try { parsed = parseInput(text); }
    catch (e) { err(e.message); return; }

    const arrays = findArrays(parsed.data);
    state = { data: parsed.data, arrays: arrays, ndjson: parsed.ndjson,
      pick: 0, mode: 'explode', excluded: Object.create(null) };
    build();
  }

  function build() {
    const src = state.arrays[state.pick];
    let res;
    try { res = flatten(src.arr, state.mode); }
    catch (e) { err('Could not flatten that structure: ' + e.message); return; }

    const cols = res.cols.filter(c => !state.excluded[c]);
    state.res = res;
    state.cols = cols;

    const h = [];
    const empty = res.rows.length === 0;

    h.push('<section><div class="card pad" style="border-color:var(--' + (empty ? 'warn' : 'ok') + ')">');
    h.push('<h2 style="margin:0;font-size:19px">' + (empty
      ? 'Nothing to flatten'
      : fmt(res.rows.length) + ' row' + (res.rows.length === 1 ? '' : 's') + ' &times; ' +
        fmt(cols.length) + ' column' + (cols.length === 1 ? '' : 's')) + '</h2>');
    if (empty) h.push('<div class="muted" style="margin-top:4px">That JSON parsed cleanly but contains no records — the array is empty. Nothing here needs converting.</div>');
    h.push('<div class="muted" style="margin-top:4px">Flattened from <code>' + esc(src.path) +
      '</code>' + (state.ndjson ? ' &middot; read as NDJSON' : '') +
      (res.truncated ? ' &middot; <strong>stopped at ' + fmt(MAX_ROWS) + ' rows</strong>' : '') + '</div>');
    h.push('</div></section>');

    /* source array picker */
    if (state.arrays.length > 1) {
      h.push('<section><label for="src">Which array should become the rows?</label>' +
        '<select id="src" style="margin-top:6px">');
      state.arrays.forEach((a, i) => {
        h.push('<option value="' + i + '"' + (i === state.pick ? ' selected' : '') + '>' +
          esc(a.path) + ' — ' + fmt(a.arr.length) + ' items</option>');
      });
      h.push('</select></section>');
    }

    /* array mode */
    h.push('<section><label>What should happen to nested arrays?</label><div class="modes" style="margin-top:7px">');
    [['explode', 'Explode into rows', 'One row per array element, parent fields repeated. A real unnest.'],
     ['join', 'Join into one cell', 'Values joined with "; " so each record stays on a single row.'],
     ['index', 'One column each', 'tags.0, tags.1, tags.2 — good for short fixed-length arrays.']
    ].forEach(m => {
      h.push('<label class="mode"><input type="radio" name="mode" value="' + m[0] + '"' +
        (state.mode === m[0] ? ' checked' : '') + '><span><b>' + esc(m[1]) + '</b><span>' + esc(m[2]) + '</span></span></label>');
    });
    h.push('</div></section>');

    /* columns */
    h.push('<section><label>Columns <span class="muted" style="font-weight:400">— untick to leave one out</span></label>');
    h.push('<div class="cols" style="margin-top:7px">');
    res.cols.forEach(c => {
      h.push('<label class="colchip"><input type="checkbox" data-col="' + esc(c) + '"' +
        (state.excluded[c] ? '' : ' checked') + '>' + esc(c) + '</label>');
    });
    h.push('</div></section>');

    /* actions */
    h.push('<section><div class="row">');
    h.push('<button class="primary" id="dl">Download CSV</button>');
    h.push('<button id="cp">Copy CSV</button>');
    h.push('<button id="reset">Start over</button>');
    h.push('</div>');
    h.push('<p class="muted" style="margin:9px 0 0">Includes a UTF-8 byte-order mark so accents survive in Excel. ' +
      'Long IDs and ZIP codes can still be mangled on open — <a href="/csv-excel-guard">check the result here</a>.</p></section>');

    /* preview */
    if (!cols.length) {
      h.push('<section><div class="empty"><h3>No columns selected</h3><p>Tick at least one column above.</p></div></section>');
    } else {
      h.push('<section><h2 style="font-size:17px;margin:0 0 9px">Preview' +
        (res.rows.length > PREVIEW_ROWS ? ' <span class="muted" style="font-weight:400;font-size:13px">&mdash; first ' +
          PREVIEW_ROWS + ' of ' + fmt(res.rows.length) + ' rows</span>' : '') + '</h2>');
      h.push('<div class="tablewrap" style="max-height:460px;overflow:auto"><table><thead><tr>');
      cols.forEach(c => h.push('<th>' + esc(c) + '</th>'));
      h.push('</tr></thead><tbody>');
      res.rows.slice(0, PREVIEW_ROWS).forEach(r => {
        h.push('<tr>');
        cols.forEach(c => {
          const v = r[c] === undefined ? '' : String(r[c]);
          h.push('<td class="mono">' + esc(v.slice(0, 80)) + (v.length > 80 ? '&hellip;' : '') + '</td>');
        });
        h.push('</tr>');
      });
      h.push('</tbody></table></div></section>');
    }

    outEl.innerHTML = h.join('');
    outEl.hidden = false;

    const sel = $('#src');
    if (sel) sel.onchange = () => { state.pick = +sel.value; state.excluded = Object.create(null); build(); };
    Array.from(outEl.querySelectorAll('input[name=mode]')).forEach(r => {
      r.onchange = () => { state.mode = r.value; state.excluded = Object.create(null); build(); };
    });
    Array.from(outEl.querySelectorAll('input[data-col]')).forEach(cb => {
      cb.onchange = () => { state.excluded[cb.dataset.col] = !cb.checked; build(); };
    });
    $('#dl').onclick = () => {
      if (!state.cols.length) { toast('Select at least one column'); return; }
      download('flattened.csv', toCSV(state.res.rows, state.cols), 'text/csv;charset=utf-8');
    };
    $('#cp').onclick = () => {
      if (!state.cols.length) { toast('Select at least one column'); return; }
      copy(toCSV(state.res.rows, state.cols).slice(1), 'CSV copied');
    };
    $('#reset').onclick = () => {
      outEl.hidden = true; outEl.innerHTML = ''; state = null;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  /* Exposed for tests. */
  window.PapercutsJSON = { parseInput, findArrays, flatten, toCSV, expand };

  /* ------------------------------------------------------------- handlers */
  if (!document.getElementById('input')) return;

  $('#convert').onclick = convert;
  $('#clear').onclick = () => {
    $('#input').value = ''; outEl.hidden = true; outEl.innerHTML = '';
    statusEl.innerHTML = ''; $('#input').focus();
  };
  $('#pick').onclick = () => $('#file').click();
  $('#file').addEventListener('change', function () {
    const f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { err('That file is ' + bytes(f.size) + '. The cap is 25 MB.'); return; }
    const fr = new FileReader();
    fr.onerror = () => err('Could not read that file.');
    fr.onload = () => { $('#input').value = String(fr.result); convert(); };
    fr.readAsText(f, 'utf-8');
  });
  $('#input').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); convert(); }
  });

  const SAMPLE = JSON.stringify({
    meta: { generated: '2026-08-31T09:00:00Z', version: 3 },
    orders: [
      { id: 1042, placed: '2026-08-14',
        customer: { name: 'Ada Lovelace', email: 'ada@example.com',
          address: { city: 'London', postcode: 'EC1A 1BB', country: 'UK' } },
        tags: ['priority', 'gift'],
        items: [ { sku: 'KB-01', name: 'Keyboard', qty: 1, price: 89.5 },
                 { sku: 'MS-04', name: 'Mouse', qty: 2, price: 24 } ] },
      { id: 1043, placed: '2026-08-15',
        customer: { name: 'Grace Hopper', email: 'grace@example.com',
          address: { city: 'New York', postcode: '10001', country: 'US' } },
        tags: ['repeat'],
        items: [ { sku: 'DK-09', name: 'Dock', qty: 1, price: 149 } ] }
    ]
  }, null, 2);

  $('#sample').onclick = () => { $('#input').value = SAMPLE; convert(); };
})();
