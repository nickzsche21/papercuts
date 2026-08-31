/* Papercuts build: inline every subresource into each page.
 *
 * Why: external <link> and <script> requests are blocked outright by a range of
 * content blockers and network filters, which leaves the page rendering as
 * unstyled HTML with dead buttons. A page with no subresources cannot suffer
 * that. It also removes a whole class of path bug and saves the round trips.
 *
 * The inline <script> blocks are allowlisted in the CSP by SHA-256 hash rather
 * than 'unsafe-inline', so the policy stays strict.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');

const PAGES = ['.', 'cors', 'csp', 'csv-excel-guard', 'invisible-characters',
  'json-to-csv', 'filename-checker', 'cron-inspector'];
const COPY = ['robots.txt', 'sitemap.xml'];

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha256 = s => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'";

const baseCss = read('assets/base.css');
const baseJs = read('assets/base.js');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const scriptHashes = new Set();
let pagesBuilt = 0, bytes = 0;

for (const page of PAGES) {
  const src = path.join(page, 'index.html');
  if (!fs.existsSync(path.join(ROOT, src))) {
    console.error('MISSING ' + src);
    process.exit(1);
  }
  let html = read(src);

  /* 1. stylesheet -> inline <style> */
  const linkRe = /[ \t]*<link rel="stylesheet" href="\/assets\/base\.css">\n?/;
  if (!linkRe.test(html)) { console.error('no stylesheet link in ' + src); process.exit(1); }
  /* Replacement FUNCTIONS, not strings. cors/app.js contains a dollar-ampersand
     sequence (the regex-escape in the Apache config generator), and inside a
     replacement STRING that sequence expands to the whole match — silently
     re-injecting the very script tags being removed. A function is taken
     literally. The guard below exists because this failed exactly that way. */
  html = html.replace(linkRe, () => '<style>\n' + baseCss.trim() + '\n</style>\n');

  /* 2. scripts -> one inline <script>, hashed */
  const scriptRe = /[ \t]*<script src="\/assets\/base\.js"><\/script>\n[ \t]*<script src="\/([^"]+)"><\/script>\n?/;
  const m = scriptRe.exec(html);
  if (m) {
    const appJs = read(m[1]);
    const combined = '\n' + baseJs.trim() + '\n;\n' + appJs.trim() + '\n';
    scriptHashes.add(sha256(combined));
    html = html.replace(scriptRe, () => '<script>' + combined + '</script>\n');
  } else if (/<script src=/.test(html)) {
    console.error('unrecognised script tags in ' + src); process.exit(1);
  }

  if (/<(link|script)[^>]*\s(href|src)="\/(assets|cors|csp|csv|json|file|cron)/.test(html)) {
    console.error('a subresource survived inlining in ' + src); process.exit(1);
  }

  const outDir = page === '.' ? DIST : path.join(DIST, page);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  pagesBuilt++; bytes += Buffer.byteLength(html);
  console.log('  ' + (page === '.' ? '/' : '/' + page).padEnd(24) +
    (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
}

for (const f of COPY) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));

/* CSP: hashes for our own inline scripts; styles stay 'unsafe-inline' because
   the tools set style="" attributes on generated markup, which no hash covers. */
const csp = [
  "default-src 'none'",
  "script-src " + [...scriptHashes].join(' '),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'"
].join('; ');

const vercel = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  outputDirectory: 'dist',
  cleanUrls: true,
  trailingSlash: false,
  headers: [{
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=(), interest-cohort=()' },
      { key: 'Content-Security-Policy', value: csp }
    ]
  }]
};
fs.writeFileSync(path.join(ROOT, 'vercel.json'), JSON.stringify(vercel, null, 2) + '\n');

console.log('\n' + pagesBuilt + ' pages, ' + (bytes / 1024).toFixed(0) + ' KB total, ' +
  scriptHashes.size + ' script hashes in the CSP');
console.log('zero external subresources');
