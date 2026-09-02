/* Post-deploy verification against the live site.
 *
 * "curl returns 200" is not "the site works" — that mistake shipped a site that
 * rendered as unstyled HTML. So this checks status, self-containment, that the
 * page carries its own CSS and JS inline, and that the security headers survived.
 *
 * Exits non-zero if anything is wrong, so the ship task can report a bad deploy
 * instead of announcing success.
 */
import { PAGES, SITE } from '../tools.mjs';

let failures = 0, checks = 0;
const ok = m => { checks++; console.log('  ok    ' + m); };
const bad = m => { checks++; failures++; console.log('  FAIL  ' + m); };

const url = p => SITE + (p === '.' ? '/' : '/' + p);

for (const p of PAGES) {
  const u = url(p);
  let res, body;
  try {
    res = await fetch(u, { redirect: 'follow' });
    body = await res.text();
  } catch (e) {
    bad(u + ' — request failed: ' + e.message);
    continue;
  }

  if (res.status === 200) ok(u + ' → 200');
  else { bad(u + ' → ' + res.status); continue; }

  /* The failure mode that actually happened: page loads, nothing renders. */
  if (/<link[^>]*rel="stylesheet"/.test(body) || /<script[^>]*\ssrc=/.test(body))
    bad(u + ' references an external subresource — content blockers will strip it');
  else ok('  self-contained');

  if (/<style>/.test(body) && /:root\s*\{/.test(body)) ok('  carries its stylesheet inline');
  else bad(u + ' has no inline stylesheet — it will render unstyled');

  if (p !== '.') {
    if (/<script>/.test(body) && /window\.PC/.test(body)) ok('  carries its script inline');
    else bad(u + ' has no inline script — the tool will not work');
  }

  if (/<title>[^<]{10,}<\/title>/.test(body)) ok('  has a title');
  else bad(u + ' has no usable <title>');
}

/* headers, checked once */
try {
  const res = await fetch(url('.'));
  const csp = res.headers.get('content-security-policy') || '';
  if (/script-src 'sha256-/.test(csp)) ok('CSP allowlists inline scripts by hash, not unsafe-inline');
  else bad('CSP is missing hash-based script-src: ' + csp.slice(0, 120));
  if (res.headers.get('x-content-type-options') === 'nosniff') ok('nosniff present');
  else bad('nosniff header missing');
} catch (e) {
  bad('header check failed: ' + e.message);
}

console.log('\n' + '-'.repeat(60));
if (failures) {
  console.log('PRODUCTION VERIFY FAILED — ' + failures + ' of ' + checks + ' checks failed.');
  process.exit(1);
}
console.log('PRODUCTION VERIFIED — ' + checks + ' checks across ' + PAGES.length + ' live pages.');
