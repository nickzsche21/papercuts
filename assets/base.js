/* Papercuts — shared helpers. No dependencies, no network. */
(function (g) {
  'use strict';

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* toast ------------------------------------------------------------- */
  let toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText =
        'position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(8px);' +
        'background:var(--ink);color:var(--bg);padding:9px 16px;border-radius:999px;' +
        'font:550 13.5px var(--sans);z-index:99;opacity:0;transition:opacity .16s,transform .16s;' +
        'pointer-events:none;box-shadow:var(--shadow);max-width:90vw;text-align:center';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    requestAnimationFrame(() => {
      toastEl.style.opacity = '1';
      toastEl.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateX(-50%) translateY(8px)';
    }, 1900);
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) { toast('Copy failed — select manually'); ta.remove(); return false; }
      ta.remove();
    }
    toast(label || 'Copied');
    return true;
  }

  /* download ---------------------------------------------------------- */
  function download(filename, content, mime) {
    const blob = content instanceof Blob
      ? content
      : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Downloaded ' + filename);
  }

  /* drop zone --------------------------------------------------------- */
  function dropzone(el, input, onFile) {
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter', 'dragover'].forEach(t =>
      el.addEventListener(t, e => { stop(e); el.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t =>
      el.addEventListener(t, e => { stop(e); el.classList.remove('over'); }));
    el.addEventListener('drop', e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFile(f);
    });
    el.addEventListener('click', () => input.click());
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) onFile(input.files[0]);
      input.value = '';
    });
  }

  const fmt = (n) => Number(n).toLocaleString('en-US');
  const bytes = (n) => n < 1024 ? n + ' B'
    : n < 1048576 ? (n / 1024).toFixed(1) + ' KB'
    : (n / 1048576).toFixed(1) + ' MB';

  /* A1-style column name ---------------------------------------------- */
  function colName(i) {
    let s = '';
    i = i + 1;
    while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  g.PC = { $, $$, esc, toast, copy, download, dropzone, fmt, bytes, colName };
})(window);
