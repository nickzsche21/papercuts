/* CSV Diff by key — 100% client-side. */
(function () {
  'use strict';
  const { $, esc, toast, copy, download, dropzone, fmt, bytes } = window.PC;

  const MAX_BYTES = 20 * 1024 * 1024;
  const SHOW = 300;
  const BOM = '﻿';

  /* --------------------------------------------------------------- parser */
  function detectDelimiter(text) {
    const lines = text.slice(0, 20000).split(/\r?\n/).filter(l => l.trim()).slice(0, 5);
    let best = ',', bestScore = -1;
    for (const d of [',', ';', '\t', '|']) {
      const counts = lines.map(l => {
        let n = 0, q = false;
        for (let i = 0; i < l.length; i++) {
          const c = l[i];
          if (c === '"') q = !q; else if (c === d && !q) n++;
        }
        return n;
      });
      if (!counts.length || counts[0] === 0) continue;
      const score = counts[0] * (counts.every(c => c === counts[0]) ? 10 : 1);
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  function parseCSV(text, delim) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
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

  function toTable(text) {
    const delim = detectDelimiter(text);
    const rows = parseCSV(text, delim);
    if (!rows.length) return null;
    const header = rows[0].map(h => h.trim());
    const body = rows.slice(1).filter(r => !(r.length === 1 && r[0] === ''));
    return { header: header, rows: body, delim: delim };
  }

  /* ------------------------------------------------------------ key guess */
  const KEYISH = ['id', 'key', 'uuid', 'sku', 'code', 'email', 'slug', 'number', 'ref'];

  function uniqueIn(table, colIdx) {
    const seen = new Set();
    for (const r of table.rows) {
      const v = (r[colIdx] || '').trim();
      if (!v) return false;
      if (seen.has(v)) return false;
      seen.add(v);
    }
    return true;
  }

  function guessKey(a, b) {
    const shared = a.header.filter(h => b.header.indexOf(h) >= 0);
    if (!shared.length) return null;
    const usable = shared.filter(h =>
      uniqueIn(a, a.header.indexOf(h)) && uniqueIn(b, b.header.indexOf(h)));
    if (!usable.length) return null;
    const named = usable.find(h => KEYISH.some(k => h.toLowerCase() === k)) ||
      usable.find(h => KEYISH.some(k => h.toLowerCase().includes(k)));
    return named || usable[0];
  }

  /* ----------------------------------------------------------------- diff */
  /* NUL joins composite key parts. A space would collide: the pair
     ("New", "York") must not produce the same key as the single value
     "New York". Declared as an escape so no control byte sits in the source. */
  const KEYSEP = '\u0000';

  function keyOf(row, header, keyCols) {
    return keyCols.map(k => (row[header.indexOf(k)] || '').trim()).join(KEYSEP);
  }

  function index(table, keyCols) {
    const map = new Map(), dupes = new Set();
    table.rows.forEach((r, i) => {
      const k = keyOf(r, table.header, keyCols);
      if (map.has(k)) dupes.add(k); else map.set(k, { row: r, line: i + 2 });
    });
    return { map: map, dupes: dupes };
  }

  function diff(a, b, keyCols) {
    const ia = index(a, keyCols), ib = index(b, keyCols);
    const sharedCols = a.header.filter(h => b.header.indexOf(h) >= 0 && keyCols.indexOf(h) < 0);
    const addedCols = b.header.filter(h => a.header.indexOf(h) < 0);
    const removedCols = a.header.filter(h => b.header.indexOf(h) < 0);

    const added = [], removed = [], changed = [];
    let unchanged = 0;

    ib.map.forEach((rb, k) => { if (!ia.map.has(k)) added.push({ key: k, row: rb.row, line: rb.line }); });
    ia.map.forEach((ra, k) => {
      const rb = ib.map.get(k);
      if (!rb) { removed.push({ key: k, row: ra.row, line: ra.line }); return; }
      const cells = [];
      sharedCols.forEach(col => {
        const va = (ra.row[a.header.indexOf(col)] || '');
        const vb = (rb.row[b.header.indexOf(col)] || '');
        if (va !== vb) cells.push({ col: col, from: va, to: vb });
      });
      if (cells.length) changed.push({ key: k, cells: cells, lineA: ra.line, lineB: rb.line });
      else unchanged++;
    });

    return {
      keyCols: keyCols, sharedCols: sharedCols, addedCols: addedCols, removedCols: removedCols,
      added: added, removed: removed, changed: changed, unchanged: unchanged,
      dupes: [...new Set([...ia.dupes, ...ib.dupes])],
      countA: a.rows.length, countB: b.rows.length
    };
  }

  function diffCSV(d, a, b) {
    const q = v => '"' + String(v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const out = [['change', ...d.keyCols, 'column', 'before', 'after'].map(q).join(',')];
    d.changed.forEach(c => c.cells.forEach(cell =>
      out.push(['changed', ...c.key.split(KEYSEP), cell.col, cell.from, cell.to].map(q).join(','))));
    d.added.forEach(r => out.push(['added', ...r.key.split(KEYSEP), '', '', ''].map(q).join(',')));
    d.removed.forEach(r => out.push(['removed', ...r.key.split(KEYSEP), '', '', ''].map(q).join(',')));
    return BOM + out.join('\r\n') + '\r\n';
  }

  window.PapercutsCsvDiff = { toTable, parseCSV, detectDelimiter, guessKey, diff, diffCSV, uniqueIn };

  /* --------------------------------------------------------------- render */
  if (!document.getElementById('a')) return;

  const statusEl = $('#status'), outEl = $('#out');
  let state = null;

  function err(m) {
    statusEl.innerHTML = '<section><div class="err">' + m + '</div></section>';
    outEl.hidden = true;
  }

  function run(keyOverride) {
    const ta = $('#a').value.trim(), tb = $('#b').value.trim();
    if (!ta || !tb) { err('Paste or drop both CSVs first.'); return; }
    const a = toTable(ta), b = toTable(tb);
    if (!a || !b) { err('One of those does not parse as a CSV.'); return; }
    if (!a.header.length || !b.header.length) { err('Both files need a header row.'); return; }

    const shared = a.header.filter(h => b.header.indexOf(h) >= 0);
    if (!shared.length) {
      err('These two files share no column names, so there is nothing to match rows on. ' +
        'Check that both have a header row and that the names line up.');
      return;
    }

    let keyCols = keyOverride;
    if (!keyCols || !keyCols.length) {
      const g = guessKey(a, b);
      keyCols = g ? [g] : [shared[0]];
    }
    statusEl.innerHTML = '';
    state = { a: a, b: b, keyCols: keyCols, shared: shared };
    render(diff(a, b, keyCols));
  }

  function render(d) {
    const H = [];
    const total = d.added.length + d.removed.length + d.changed.length;

    H.push('<section><div class="card pad" style="border-color:var(--' +
      (d.dupes.length ? 'bad' : total ? 'warn' : 'ok') + ')">');
    H.push('<h2 style="margin:0;font-size:19px">' + (total
      ? fmt(d.changed.length) + ' changed, ' + fmt(d.added.length) + ' added, ' + fmt(d.removed.length) + ' removed'
      : 'Identical — every row matches') + '</h2>');
    H.push('<div class="muted" style="margin-top:4px">Matched on <code>' +
      d.keyCols.map(esc).join(' + ') + '</code> &middot; ' + fmt(d.unchanged) + ' unchanged &middot; ' +
      fmt(d.countA) + ' rows before, ' + fmt(d.countB) + ' after &middot; row order ignored</div>');
    H.push('</div></section>');

    /* key picker */
    H.push('<section><label for="keysel">Match rows on</label><div class="row" style="margin-top:6px">');
    H.push('<select id="keysel" style="max-width:280px;width:auto">' + state.shared.map(h =>
      '<option' + (d.keyCols.length === 1 && d.keyCols[0] === h ? ' selected' : '') + '>' +
      esc(h) + '</option>').join('') + '</select>');
    H.push('<span class="muted">a column whose values are unique in both files</span></div></section>');

    if (d.dupes.length) {
      H.push('<section><div class="card pad" style="border-color:var(--bad)">' +
        '<span class="badge bad">ambiguous</span> <strong style="margin-left:6px">' +
        fmt(d.dupes.length) + ' duplicate key' + (d.dupes.length === 1 ? '' : 's') + '</strong>' +
        '<div class="muted" style="margin-top:5px">These values appear more than once, so rows cannot be paired ' +
        'reliably and the result below may be wrong for them. Pick a different column, or a combination that is unique: ' +
        '<code>' + d.dupes.slice(0, 8).map(k => esc(k.split(KEYSEP).join(' + '))).join('</code>, <code>') + '</code>' +
        (d.dupes.length > 8 ? ' and ' + fmt(d.dupes.length - 8) + ' more' : '') + '</div></div></section>');
    }

    if (d.addedCols.length || d.removedCols.length) {
      H.push('<section><div class="note"><strong>Columns differ.</strong> ' +
        (d.addedCols.length ? 'Added: <code>' + d.addedCols.map(esc).join('</code>, <code>') + '</code>. ' : '') +
        (d.removedCols.length ? 'Removed: <code>' + d.removedCols.map(esc).join('</code>, <code>') + '</code>. ' : '') +
        'Only the ' + fmt(d.sharedCols.length) + ' shared column' + (d.sharedCols.length === 1 ? '' : 's') +
        ' are compared, so a new column does not make every row look modified.</div></section>');
    }

    H.push('<section><div class="stats">');
    H.push('<div class="stat ' + (d.changed.length ? 'warn' : 'ok') + '"><b>' + fmt(d.changed.length) + '</b><span>changed</span></div>');
    H.push('<div class="stat ' + (d.added.length ? 'ok' : '') + '"><b>' + fmt(d.added.length) + '</b><span>added</span></div>');
    H.push('<div class="stat ' + (d.removed.length ? 'bad' : '') + '"><b>' + fmt(d.removed.length) + '</b><span>removed</span></div>');
    H.push('<div class="stat"><b>' + fmt(d.unchanged) + '</b><span>unchanged</span></div>');
    H.push('</div></section>');

    if (d.changed.length) {
      const flat = [];
      d.changed.forEach(c => c.cells.forEach(cell => flat.push({ key: c.key, cell: cell })));
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Changed cells' +
        (flat.length > SHOW ? ' <span class="muted" style="font-weight:400;font-size:13px">&mdash; first ' +
          fmt(SHOW) + ' of ' + fmt(flat.length) + '</span>' : '') + '</h2>');
      H.push('<div class="tablewrap" style="max-height:520px;overflow:auto"><table><thead><tr><th>' +
        d.keyCols.map(esc).join(' + ') + '</th><th>Column</th><th>Before</th><th>After</th></tr></thead><tbody>');
      flat.slice(0, SHOW).forEach(f => {
        H.push('<tr><td class="k">' + esc(f.key.split(KEYSEP).join(' + ')) + '</td>' +
          '<td>' + esc(f.cell.col) + '</td>' +
          '<td class="mono before cellwas">' + esc(f.cell.from.slice(0, 60) || '(empty)') + '</td>' +
          '<td class="mono after">' + esc(f.cell.to.slice(0, 60) || '(empty)') + '</td></tr>');
      });
      H.push('</tbody></table></div></section>');
    }

    ['added', 'removed'].forEach(kind => {
      const list = d[kind];
      if (!list.length) return;
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">' +
        (kind === 'added' ? 'New rows' : 'Rows no longer present') + '</h2>');
      H.push('<div class="tablewrap" style="max-height:300px;overflow:auto"><table><thead><tr><th>' +
        d.keyCols.map(esc).join(' + ') + '</th><th>Row</th></tr></thead><tbody>');
      list.slice(0, SHOW).forEach(r => {
        const tbl = kind === 'added' ? state.b : state.a;
        H.push('<tr><td class="k">' + esc(r.key.split(KEYSEP).join(' + ')) + '</td>' +
          '<td class="mono" style="font-size:12px">' +
          esc(r.row.slice(0, 8).join(', ').slice(0, 110)) + '</td></tr>');
      });
      H.push('</tbody></table></div>');
      if (list.length > SHOW) H.push('<p class="muted" style="margin:7px 0 0">Showing ' + fmt(SHOW) + ' of ' + fmt(list.length) + '.</p>');
      H.push('</section>');
    });

    H.push('<section><div class="row">');
    if (total) H.push('<button class="primary" id="dl">Download the diff as CSV</button>');
    H.push('<button id="cp">Copy a summary</button><button id="reset">Compare something else</button>');
    H.push('</div></section>');

    outEl.innerHTML = H.join('');
    outEl.hidden = false;

    $('#keysel').onchange = e => run([e.target.value]);
    const dl = $('#dl');
    if (dl) dl.onclick = () => download('diff.csv', diffCSV(d, state.a, state.b), 'text/csv;charset=utf-8');
    $('#cp').onclick = () => copy(summary(d), 'Summary copied');
    $('#reset').onclick = () => {
      outEl.hidden = true; outEl.innerHTML = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function summary(d) {
    const L = ['CSV diff, matched on ' + d.keyCols.join(' + '), ''];
    L.push(d.changed.length + ' changed, ' + d.added.length + ' added, ' +
      d.removed.length + ' removed, ' + d.unchanged + ' unchanged.');
    if (d.addedCols.length) L.push('Columns added: ' + d.addedCols.join(', '));
    if (d.removedCols.length) L.push('Columns removed: ' + d.removedCols.join(', '));
    if (d.dupes.length) L.push('WARNING: ' + d.dupes.length + ' duplicate keys make pairing ambiguous.');
    L.push('');
    d.changed.slice(0, 40).forEach(c => {
      L.push(c.key.split(KEYSEP).join(' + '));
      c.cells.forEach(cell => L.push('    ' + cell.col + ': "' + cell.from + '" -> "' + cell.to + '"'));
    });
    if (d.changed.length > 40) L.push('  ... and ' + (d.changed.length - 40) + ' more changed rows');
    L.push('', 'Compared with https://papercuts-mauve.vercel.app/csv-diff');
    return L.join('\n');
  }

  /* ------------------------------------------------------------ handlers */
  function wire(dropId, fileId, taId) {
    dropzone($(dropId), $(fileId), file => {
      if (file.size > MAX_BYTES) { err('That file is ' + bytes(file.size) + '. The cap is 20 MB.'); return; }
      const fr = new FileReader();
      fr.onerror = () => err('Could not read that file.');
      fr.onload = () => {
        $(taId).value = String(fr.result);
        if ($('#a').value.trim() && $('#b').value.trim()) run();
      };
      fr.readAsText(file, 'utf-8');
    });
  }
  wire('#dropA', '#fileA', '#a');
  wire('#dropB', '#fileB', '#b');

  $('#run').onclick = () => run();
  $('#clear').onclick = () => {
    $('#a').value = ''; $('#b').value = '';
    outEl.hidden = true; outEl.innerHTML = ''; statusEl.innerHTML = ''; $('#a').focus();
  };

  const SAMPLE_A = [
    'sku,name,price,stock',
    'A-100,Widget,9.99,42',
    'A-101,Gadget,24.50,7',
    'A-102,Doohickey,4.00,0',
    'A-103,Thingamajig,15.75,3'
  ].join('\n');
  /* deliberately reordered, to show that row movement is not a change */
  const SAMPLE_B = [
    'sku,name,price,stock,supplier',
    'A-103,Thingamajig,15.75,3,Acme',
    'A-101,Gadget,27.00,7,Acme',
    'A-100,Widget,9.99,40,Globex',
    'A-104,Whatsit,6.25,12,Globex'
  ].join('\n');

  $('#sample').onclick = () => { $('#a').value = SAMPLE_A; $('#b').value = SAMPLE_B; run(); };
})();
