/* Preflight: everything that must be true before anything is deployed.
 *
 * This exists because the two worst bugs so far were not logic errors — they
 * were a page shipped with a subresource that content blockers refuse, and raw
 * control characters landing in source. Both are mechanically checkable, so
 * they are checked mechanically rather than remembered.
 *
 * Exits non-zero on any failure. The daily ship task must treat a non-zero
 * exit as "do not deploy".
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PAGES, TOOLS, SUITES, SITE } from '../tools.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

let failures = 0, checks = 0;
const ok = m => { checks++; console.log('  ok    ' + m); };
const bad = m => { checks++; failures++; console.log('  FAIL  ' + m); };
const section = m => console.log('\n' + m);

/* ------------------------------------------------------- 1. every tool exists */
section('Files');
for (const t of TOOLS) {
  if (exists(t + '/index.html') && exists(t + '/app.js')) ok(t + ' has index.html and app.js');
  else bad(t + ' is missing index.html or app.js');
}

/* ------------------------------------------- 2. registered in every index */
section('Registration — a tool must appear everywhere, not just in the build');
const hub = read('index.html');
const sitemap = read('sitemap.xml');
const registry = read('TOOLS.md');
for (const t of TOOLS) {
  if (hub.includes('href="/' + t + '"')) ok(t + ' is linked from the hub');
  else bad(t + ' is NOT linked from the hub page');
  if (sitemap.includes('/' + t + '<')) ok(t + ' is in sitemap.xml');
  else bad(t + ' is NOT in sitemap.xml');
  if (registry.includes('/' + t + ')') || registry.includes('/' + t + '\n')) ok(t + ' is in TOOLS.md');
  else bad(t + ' is NOT recorded in TOOLS.md');
}

/* ------------------------------------------------ 3. every tool has a suite */
section('Tests');
for (const s of SUITES) {
  if (exists('test/test-' + s + '.mjs')) ok('suite ' + s + ' exists');
  else bad('suite ' + s + ' is missing');
}
if (SUITES.length >= TOOLS.length) ok('at least one suite per tool (' + SUITES.length + ' suites, ' + TOOLS.length + ' tools)');
else bad('only ' + SUITES.length + ' suites for ' + TOOLS.length + ' tools — a tool shipped without tests');

let totalAssertions = 0;
for (const s of SUITES) {
  try {
    const out = execFileSync('node', ['test/test-' + s + '.mjs'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    const m = /(\d+) passed, (\d+) failed/.exec(out);
    if (m && m[2] === '0') { totalAssertions += +m[1]; ok(s + ': ' + m[1] + ' assertions'); }
    else bad(s + ': ' + (m ? m[2] + ' failing assertions' : 'no result line'));
  } catch (e) {
    bad(s + ': suite exited non-zero\n' + String(e.stdout || e.message).split('\n').filter(l => l.startsWith('FAIL')).slice(0, 5).join('\n'));
  }
}

/* ------------------------------------------------- 4. no control characters */
section('Source hygiene');
/* Raw control bytes in source have bitten twice: a NUL key separator that
   looked like a space, and a heredoc that silently corrupted a regex. */
/* Built from escapes, or this check would contain the very thing it forbids.
   Tab, newline and carriage return are legitimate and excluded. */
const CTRL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]');
let ctrlHits = 0;
for (const t of TOOLS.concat(['assets'])) {
  for (const f of ['app.js', 'index.html', 'base.js', 'base.css']) {
    const p = t + '/' + f;
    if (!exists(p)) continue;
    const src = read(p);
    if (CTRL.test(src)) {
      const line = src.split('\n').findIndex(l => CTRL.test(l)) + 1;
      bad(p + ' contains a raw control character at line ' + line + ' — use a \\u escape');
      ctrlHits++;
    }
  }
}
if (!ctrlHits) ok('no raw control characters in any source file');

/* --------------------------------------------------------- 5. build is clean */
section('Build');
try {
  const out = execFileSync('node', ['build.mjs'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  if (/zero external subresources/.test(out)) ok('build succeeded');
  else bad('build did not report zero subresources');
  const pagesBuilt = (out.match(/^\s+\//gm) || []).length;
  if (pagesBuilt === PAGES.length) ok('built all ' + PAGES.length + ' pages');
  else bad('built ' + pagesBuilt + ' pages, expected ' + PAGES.length);
} catch (e) {
  bad('build.mjs failed: ' + String(e.stdout || e.message).slice(0, 300));
}

/* ------------------------------- 6. the built output really is self-contained */
section('Self-containment (the bug that shipped a blank-looking site)');
let subHits = 0;
for (const p of PAGES) {
  const f = p === '.' ? 'dist/index.html' : 'dist/' + p + '/index.html';
  if (!exists(f)) { bad(f + ' was not built'); continue; }
  const html = read(f);
  if (/<link[^>]*rel="stylesheet"/.test(html) || /<script[^>]*\ssrc=/.test(html)) {
    bad(f + ' still references an external subresource');
    subHits++;
  }
}
if (!subHits) ok('all ' + PAGES.length + ' built pages are fully self-contained');

/* --------------------------------------------------------------- 7. secrets */
section('Secrets');
const SECRET = /sk-[A-Za-z0-9]{20}|gh[pousr]_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY/;
let secretHits = 0;
const walk = dir => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
    const rel = dir === '.' ? e.name : dir + '/' + e.name;
    if (e.isDirectory()) { walk(rel); continue; }
    if (!/\.(js|mjs|html|json|md|txt|xml)$/.test(e.name)) continue;
    if (SECRET.test(read(rel))) { bad('possible secret in ' + rel); secretHits++; }
  }
};
walk('.');
if (!secretHits) ok('no credential-shaped strings in tracked files');

/* ---------------------------------------------------------------- summary */
console.log('\n' + '-'.repeat(60));
if (failures) {
  console.log('PREFLIGHT FAILED — ' + failures + ' of ' + checks + ' checks failed. Do not deploy.');
  process.exit(1);
}
console.log('PREFLIGHT PASSED — ' + checks + ' checks, ' + totalAssertions +
  ' assertions across ' + SUITES.length + ' suites, ' + PAGES.length + ' pages self-contained.');
console.log('Deploy target: ' + SITE);
