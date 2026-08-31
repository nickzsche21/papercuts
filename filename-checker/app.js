/* Will this filename break? — 100% client-side. */
(function () {
  'use strict';
  const { $, esc, toast, copy, download, fmt } = window.PC;

  const PLATFORMS = [
    ['win', 'Windows'], ['mac', 'macOS'], ['nix', 'Linux'],
    ['sp', 'SharePoint'], ['s3', 'S3'], ['git', 'Git']
  ];

  const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9²³¹]|LPT[1-9²³¹])(\.|$)/i;
  const WIN_ILLEGAL = /[<>:"/\\|?*]/g;
  const SP_ILLEGAL = /[<>:"/\\|?*#%{}~&]/g;
  /* Separate non-global copies: .test() on a /g regex is stateful and would
     alternate true/false across calls. */
  const CTRL_SRC  = '[\\u0000-\\u001F\\u007F]';
  const INVIS_SRC = '[\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060\\uFEFF]';
  const CTRL = new RegExp(CTRL_SRC, 'g'),   CTRL_T = new RegExp(CTRL_SRC);
  const INVIS = new RegExp(INVIS_SRC, 'g'), INVIS_T = new RegExp(INVIS_SRC);
  const S3_SAFE = /^[A-Za-z0-9!\-_.*'()/ ]+$/;

  const byteLen = s => new TextEncoder().encode(s).length;

  /* --------------------------------------------------------------- checks */
  /* Each issue: {plat:[..], sev, msg} */
  function checkName(name) {
    const issues = [];
    const add = (plat, sev, msg) => issues.push({ plat: plat, sev: sev, msg: msg });
    const base = name.replace(/^.*\//, '');            /* ignore any path prefix */
    const stem = base.replace(/\.[^.]*$/, '');

    if (!base) { add(['win','mac','nix','sp','s3','git'], 'bad', 'Empty name.'); return issues; }

    if (RESERVED.test(base))
      add(['win'], 'bad', 'Reserved Windows device name (' + stem.toUpperCase() +
        '). Illegal with any extension — Windows cannot create this file at all.');

    const winBad = base.match(WIN_ILLEGAL);
    if (winBad)
      add(['win'], 'bad', 'Illegal on Windows: ' + [...new Set(winBad)].map(c => '"' + c + '"').join(' ') +
        '. The upload or extract will fail.');

    if (/:/.test(base))
      add(['mac'], 'warn', 'A colon is shown as a slash in Finder and is rejected by many macOS apps.');

    if (CTRL_T.test(base))
      add(['win','mac','nix','sp','s3','git'], 'bad', 'Contains a control character. Almost nothing will accept this name.');

    if (INVIS_T.test(base))
      add(['win','mac','nix','sp','s3','git'], 'warn',
        'Contains invisible characters, so two names that look identical are different files.');

    if (/[ .]$/.test(base))
      add(['win','sp'], 'bad', 'Ends in a space or a dot. Windows silently strips it, so this collides with the trimmed name.');

    if (/^\s/.test(base))
      add(['sp','s3'], 'warn', 'Starts with a space. SharePoint rejects it and S3 keys become hard to address.');

    if (/^-/.test(base))
      add(['nix','mac'], 'warn', 'Starts with a dash, so command-line tools read it as a flag. You need ./ or -- to touch it.');

    const spBad = base.match(SP_ILLEGAL);
    if (spBad)
      add(['sp'], 'bad', 'Illegal in SharePoint and OneDrive: ' + [...new Set(spBad)].map(c => '"' + c + '"').join(' ') + '.');
    if (/^~\$|^\.lock$|^desktop\.ini$|_vti_/i.test(base))
      add(['sp'], 'bad', 'SharePoint reserves this name pattern and will refuse to sync it.');

    if (!S3_SAFE.test(base))
      add(['s3'], 'warn', 'Contains characters that must be percent-encoded in an S3 key. Presigned URLs and CLI tooling get fiddly.');

    if (/\s/.test(base))
      add(['s3'], 'warn', 'Spaces become %20 in every URL that references this object.');

    const bytes = byteLen(base);
    if (bytes > 255)
      add(['nix','mac'], 'bad', 'Name is ' + bytes + ' bytes; the ext4 and APFS limit is 255 bytes. Note that accents and emoji cost several bytes each.');
    else if (bytes > 200)
      add(['nix','mac'], 'warn', 'Name is ' + bytes + ' bytes, close to the 255-byte limit — adding a folder prefix may push it over.');

    if (base.length > 255)
      add(['win','sp'], 'bad', 'Over 255 characters. Windows and SharePoint both reject this.');
    else if (base.length > 128)
      add(['win','sp'], 'warn', 'At ' + base.length + ' characters, the full path is likely to exceed the 260-character Windows limit once it is inside a few folders.');

    if (base !== base.normalize('NFC'))
      add(['mac','git'], 'warn', 'Not in NFC normal form. macOS may store it differently, which makes Git report a phantom modification.');

    if (/\.$/.test(stem) || /\.\./.test(base))
      add(['win','nix'], 'warn', 'Consecutive or trailing dots confuse extension handling and some archive tools.');

    if (/^\./.test(base) && base !== '.' )
      add(['nix','mac'], 'warn', 'Leading dot means hidden. Fine if intended, invisible to the recipient if not.');

    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(base))
      add(['win','git','s3'], 'warn', 'Contains emoji. Legal in most places but breaks older tooling, some ZIP implementations and many CI runners.');

    if (/^(\.git|\.gitmodules|\.gitattributes)$/i.test(base) === false && /^\.git/i.test(base))
      add(['git'], 'warn', 'Names starting with .git are treated specially by Git and may be refused.');

    return issues;
  }

  /* --------------------------------------------------------- safe rewrite */
  function safeName(name) {
    let s = name.replace(/^.*\//, '');
    s = s.normalize('NFC').replace(CTRL, '').replace(INVIS, '');
    s = s.replace(SP_ILLEGAL, '-');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/[ .]+$/g, '');
    s = s.replace(/^-+/, '');
    if (!s) s = 'untitled';
    if (RESERVED.test(s)) {
      const dot = s.indexOf('.');
      s = dot > 0 ? s.slice(0, dot) + '-file' + s.slice(dot) : s + '-file';
    }
    /* keep the extension while trimming to 200 bytes */
    const m = /^(.*?)(\.[A-Za-z0-9]{1,10})?$/.exec(s);
    let stem = m[1] || s, ext = m[2] || '';
    while (byteLen(stem + ext) > 200 && stem.length > 1) stem = stem.slice(0, -1);
    s = (stem + ext).replace(/[ .]+$/g, '');
    return s || 'untitled';
  }

  /* ------------------------------------------------------------ collisions */
  function findCollisions(names) {
    const byLower = Object.create(null), byNFC = Object.create(null);
    const out = [];
    names.forEach(n => {
      const k = n.toLowerCase();
      (byLower[k] = byLower[k] || []).push(n);
      const k2 = n.normalize('NFC');
      (byNFC[k2] = byNFC[k2] || []).push(n);
    });
    Object.keys(byLower).forEach(k => {
      const g = byLower[k];
      if (g.length > 1 && new Set(g).size > 1)
        out.push({ kind: 'case', names: [...new Set(g)],
          why: 'These differ only by capitalisation. They are separate files on Linux and the same file on macOS and Windows — a repo containing both cannot be checked out.' });
    });
    Object.keys(byNFC).forEach(k => {
      const g = [...new Set(byNFC[k])];
      if (g.length > 1)
        out.push({ kind: 'unicode', names: g,
          why: 'These look identical but use different Unicode normal forms. They collide on macOS and stay distinct on Linux.' });
    });
    const trimmed = Object.create(null);
    names.forEach(n => {
      const k = n.replace(/[ .]+$/g, '');
      if (k !== n) (trimmed[k] = trimmed[k] || []).push(n);
    });
    Object.keys(trimmed).forEach(k => {
      if (names.indexOf(k) >= 0)
        out.push({ kind: 'trailing', names: [k].concat(trimmed[k]),
          why: 'Windows strips trailing dots and spaces, so these become the same file and one overwrites the other.' });
    });
    return out;
  }

  /* --------------------------------------------------------------- render */
  const statusEl = $('#status'), outEl = $('#out');

  function render(names) {
    const rows = names.map(n => {
      const issues = checkName(n);
      const worst = Object.create(null);
      PLATFORMS.forEach(p => { worst[p[0]] = 'ok'; });
      issues.forEach(i => i.plat.forEach(p => {
        if (i.sev === 'bad') worst[p] = 'bad';
        else if (worst[p] === 'ok') worst[p] = 'warn';
      }));
      return { name: n, issues: issues, worst: worst, safe: safeName(n) };
    });

    const collisions = findCollisions(names);
    const broken = rows.filter(r => r.issues.some(i => i.sev === 'bad')).length;
    const risky = rows.filter(r => !r.issues.some(i => i.sev === 'bad') && r.issues.length).length;
    const clean = rows.length - broken - risky;
    const h = [];

    h.push('<section><div class="card pad" style="border-color:' +
      (broken ? 'var(--bad)' : (risky || collisions.length) ? 'var(--warn)' : 'var(--ok)') + '">');
    h.push('<h2 style="margin:0;font-size:19px">' +
      (broken ? fmt(broken) + ' name' + (broken === 1 ? '' : 's') + ' will be rejected somewhere'
        : (risky || collisions.length) ? 'No hard failures, but ' + fmt(risky + collisions.length) + ' thing' +
          (risky + collisions.length === 1 ? '' : 's') + ' to watch'
        : 'All ' + fmt(rows.length) + ' names are safe everywhere') + '</h2>');
    h.push('<div class="muted" style="margin-top:4px">' + fmt(rows.length) + ' name' +
      (rows.length === 1 ? '' : 's') + ' checked against Windows, macOS, Linux, SharePoint, S3 and Git</div></div></section>');

    h.push('<section><div class="stats">');
    h.push('<div class="stat bad"><b>' + fmt(broken) + '</b><span>will fail</span></div>');
    h.push('<div class="stat warn"><b>' + fmt(risky) + '</b><span>risky</span></div>');
    h.push('<div class="stat ok"><b>' + fmt(clean) + '</b><span>safe</span></div>');
    h.push('<div class="stat ' + (collisions.length ? 'bad' : '') + '"><b>' + fmt(collisions.length) + '</b><span>collisions</span></div>');
    h.push('</div></section>');

    if (collisions.length) {
      h.push('<section><h2 style="font-size:17px;margin:0 0 9px">Names that collide with each other</h2>');
      collisions.forEach(c => {
        h.push('<div class="card pad" style="margin-bottom:8px;border-color:var(--bad)">' +
          '<span class="badge bad">' + c.kind + ' collision</span>' +
          '<div class="mono" style="margin-top:6px">' + c.names.map(n => esc(n)).join('<br>') + '</div>' +
          '<div class="muted" style="margin-top:5px">' + esc(c.why) + '</div></div>');
      });
      h.push('</section>');
    }

    const bad = rows.filter(r => r.issues.length);
    if (bad.length) {
      h.push('<section><h2 style="font-size:17px;margin:0 0 6px">Name by name</h2>');
      h.push('<div class="legend" style="margin-bottom:9px">' +
        PLATFORMS.map(p => '<span><strong>' + p[1] + '</strong></span>').join('') + '</div>');
      h.push('<div class="tablewrap" style="max-height:600px;overflow:auto"><table><thead><tr><th>Name</th>' +
        PLATFORMS.map(p => '<th style="text-align:center">' + p[1] + '</th>').join('') +
        '<th>What is wrong</th><th>Safe version</th></tr></thead><tbody>');
      bad.forEach(r => {
        h.push('<tr><td class="name">' + esc(r.name) + '</td>');
        PLATFORMS.forEach(p => {
          const st = r.worst[p[0]];
          h.push('<td style="text-align:center"><span class="plat ' + st + '">' +
            (st === 'ok' ? '&#10003;' : st === 'warn' ? '!' : '&#10007;') + '</span></td>');
        });
        h.push('<td>' + r.issues.map(i =>
          '<div style="margin-bottom:4px"><span class="badge ' + (i.sev === 'bad' ? 'bad' : 'warn') + '">' +
          i.plat.map(p => PLATFORMS.find(x => x[0] === p)[1]).join(', ') + '</span> ' +
          '<span class="muted">' + esc(i.msg) + '</span></div>').join('') + '</td>');
        h.push('<td class="name">' + (r.safe !== r.name
          ? '<span style="color:var(--ok)">' + esc(r.safe) + '</span>'
          : '<span class="muted">unchanged</span>') + '</td></tr>');
      });
      h.push('</tbody></table></div></section>');
    }

    const renames = rows.filter(r => r.safe !== r.name);
    h.push('<section><div class="row">');
    if (renames.length) {
      h.push('<button class="primary" id="cp-script">Copy rename script (' + renames.length + ')</button>');
      h.push('<button id="cp-names">Copy safe names</button>');
    }
    h.push('<button id="cp-report">Copy report</button>');
    h.push('<button id="reset">Check another set</button>');
    h.push('</div>');
    if (renames.length)
      h.push('<p class="muted" style="margin:9px 0 0">The script uses <code>mv -n</code>, which refuses to overwrite an existing file. Read it before you run it.</p>');
    h.push('</section>');

    outEl.innerHTML = h.join('');
    outEl.hidden = false;
    statusEl.innerHTML = '';

    const sh = () => '#!/bin/sh\n# Generated by papercuts-mauve.vercel.app/filename-checker\n# Review before running.\nset -e\n' +
      renames.map(r => 'mv -n -- ' + q(r.name) + ' ' + q(r.safe)).join('\n') + '\n';
    const q = s => "'" + s.replace(/'/g, "'\\''") + "'";

    if (renames.length) {
      $('#cp-script').onclick = () => copy(sh(), 'Rename script copied');
      $('#cp-names').onclick = () => copy(renames.map(r => r.safe).join('\n'), 'Safe names copied');
    }
    $('#cp-report').onclick = () => copy(report(rows, collisions), 'Report copied');
    $('#reset').onclick = () => {
      outEl.hidden = true; outEl.innerHTML = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function report(rows, collisions) {
    const L = ['Filename check — ' + rows.length + ' names', ''];
    rows.filter(r => r.issues.length).forEach(r => {
      L.push(r.name);
      r.issues.forEach(i => L.push('  [' + i.sev.toUpperCase() + '] ' +
        i.plat.map(p => PLATFORMS.find(x => x[0] === p)[1]).join(', ') + ': ' + i.msg));
      if (r.safe !== r.name) L.push('  -> suggested: ' + r.safe);
      L.push('');
    });
    collisions.forEach(c => {
      L.push('COLLISION (' + c.kind + '): ' + c.names.join(' / '));
      L.push('  ' + c.why); L.push('');
    });
    L.push('(Checked with https://papercuts-mauve.vercel.app/filename-checker)');
    return L.join('\n');
  }

  /* Exposed for tests. */
  window.PapercutsNames = { checkName, safeName, findCollisions, byteLen };

  /* ------------------------------------------------------------- handlers */
  if (!document.getElementById('input')) return;

  function run() {
    const names = $('#input').value.split('\n').map(s => s.replace(/\r$/, '')).filter(s => s.trim());
    if (!names.length) {
      statusEl.innerHTML = '<section><div class="err">Add at least one filename.</div></section>';
      outEl.hidden = true; return;
    }
    if (names.length > 20000) {
      statusEl.innerHTML = '<section><div class="err">That is over 20,000 names. Try a smaller batch.</div></section>';
      return;
    }
    statusEl.innerHTML = '';
    render(names);
  }

  $('#check').onclick = run;
  $('#clear').onclick = () => {
    $('#input').value = ''; outEl.hidden = true; outEl.innerHTML = '';
    statusEl.innerHTML = ''; $('#input').focus();
  };
  $('#pickfolder').onclick = () => $('#folder').click();
  $('#folder').addEventListener('change', function () {
    const names = Array.from(this.files || []).map(f => f.webkitRelativePath || f.name);
    this.value = '';
    if (!names.length) { toast('No files found in that folder'); return; }
    $('#input').value = names.join('\n');
    run();
  });
  $('#input').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  const SAMPLE = [
    'Q3 Report FINAL.docx',
    'con.txt',
    'invoice: March 2026.pdf',
    'README.md',
    'readme.md',
    'budget<draft>.xlsx',
    'notes ',
    'notes',
    '-rf.sh',
    'Ünderscore.txt',
    'photo 📸 2026.jpg',
    'report..pdf',
    'desktop.ini',
    'a-very-long-name-that-keeps-going-and-going-and-going-because-someone-pasted-an-entire-email-subject-line-into-the-save-dialog-and-then-added-v2-final-revised-approved-signed-off-really-final-this-time.docx'
  ].join('\n');

  $('#sample').onclick = () => { $('#input').value = SAMPLE; run(); };
})();
