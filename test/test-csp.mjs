/* Headless tests for the CSP violation decoder. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = {
  document: { getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], createElement: () => ({ style: {} }) },
  navigator: {}, console, setTimeout, URL, Set, Map,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/assets/base.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/csp/app.js', 'utf8'), sandbox);
const C = sandbox.PapercutsCSP;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const one = s => C.parseViolations(s)[0];

/* Real Chrome console strings. */
const V = {
  extScript: `Refused to load the script 'https://cdn.jsdelivr.net/npm/chart.js' because it violates the following Content Security Policy directive: "script-src 'self'".`,
  inlineScript: `Refused to execute inline script because it violates the following Content Security Policy directive: "script-src 'self'". Either the 'unsafe-inline' keyword, a hash ('sha256-abc'), or a nonce ('nonce-...') is required to enable inline execution.`,
  inlineHandler: `Refused to execute inline event handler because it violates the following Content Security Policy directive: "script-src-attr 'none'".`,
  evalStr: `Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: "script-src 'self'".`,
  style: `Refused to load the stylesheet 'https://fonts.googleapis.com/css2?family=Inter' because it violates the following Content Security Policy directive: "style-src 'self'".`,
  inlineStyle: `Refused to apply inline style because it violates the following Content Security Policy directive: "style-src 'self'".`,
  font: `Refused to load the font 'https://fonts.gstatic.com/s/inter/v12/a.woff2' because it violates the following Content Security Policy directive: "font-src 'self'".`,
  img: `Refused to load the image 'https://images.unsplash.com/photo-1.jpg' because it violates the following Content Security Policy directive: "img-src 'self' data:".`,
  connect: `Refused to connect to 'https://api.example.com/v1/events' because it violates the following Content Security Policy directive: "connect-src 'self'".`,
  frame: `Refused to frame 'https://www.youtube.com/embed/abc' because it violates the following Content Security Policy directive: "frame-src 'none'".`,
  worker: `Refused to create a worker from 'blob:https://app.example.com/1234' because it violates the following Content Security Policy directive: "worker-src 'self'".`,
  form: `Refused to send form data to 'https://evil.example.com/collect' because it violates the following Content Security Policy directive: "form-action 'self'".`,
  media: `Refused to load media from 'https://cdn.example.com/v.mp4' because it violates the following Content Security Policy directive: "media-src 'self'".`,
  reportOnly: `[Report Only] Refused to load the image 'https://images.unsplash.com/photo-1.jpg' because it violates the following Content Security Policy directive: "img-src 'self'".`,
};

console.log('--- violation classification ---');
t('external script', one(V.extScript).directive, 'script-src');
t('external script kind', one(V.extScript).kind, 'url');
t('inline script', one(V.inlineScript).kind, 'inline-script');
t('inline handler kind', one(V.inlineHandler).kind, 'inline-handler');
t('inline handler directive', one(V.inlineHandler).directive, 'script-src-attr');
t('eval', one(V.evalStr).kind, 'eval');
t('eval directive', one(V.evalStr).directive, 'script-src');
t('stylesheet', one(V.style).directive, 'style-src');
t('inline style', one(V.inlineStyle).kind, 'inline-style');
t('font', one(V.font).directive, 'font-src');
t('image', one(V.img).directive, 'img-src');
t('connect', one(V.connect).directive, 'connect-src');
t('frame', one(V.frame).directive, 'frame-src');
t('worker', one(V.worker).directive, 'worker-src');
t('form-action', one(V.form).directive, 'form-action');
t('media', one(V.media).directive, 'media-src');
t('report-only flagged', one(V.reportOnly).reportOnly, true);
t('enforced not flagged', one(V.img).reportOnly, false);

console.log('--- source derivation ---');
t('https url to origin', C.sourceFor('https://cdn.jsdelivr.net/npm/chart.js'), 'https://cdn.jsdelivr.net');
t('strips path and query', C.sourceFor('https://fonts.googleapis.com/css2?family=Inter'), 'https://fonts.googleapis.com');
t('keeps port', C.sourceFor('https://api.example.com:8443/x'), 'https://api.example.com:8443');
t('data uri', C.sourceFor('data:image/png;base64,AAA'), 'data:');
t('blob uri', C.sourceFor('blob:https://app.example.com/1234'), 'blob:');
t('websocket', C.sourceFor('wss://rt.example.com/socket'), 'wss://rt.example.com');
t('garbage returns null', C.sourceFor('not a url'), null);
t('null input', C.sourceFor(null), null);

console.log('--- multi-line parsing ---');
const many = C.parseViolations([V.extScript, V.style, V.font, V.connect].join('\n'));
t('parses four lines', many.length, 4);
t('blank lines ignored', C.parseViolations('\n\n' + V.img + '\n\n').length, 1);
t('unrelated lines ignored', C.parseViolations('TypeError: x is not a function\n' + V.img).length, 1);
t('no violations returns empty', C.parseViolations('hello world').length, 0);
t('reads the effective directive from the message',
  C.parseViolations(V.img)[0].currentValue, "'self' data:");

console.log('--- policy parse and serialize ---');
t('parse policy', C.parsePolicy("default-src 'self'; script-src 'self' https://cdn.io"),
  { 'default-src': ["'self'"], 'script-src': ["'self'", 'https://cdn.io'] });
t('round trips', C.serialize(C.parsePolicy("default-src 'self'; img-src *")),
  "default-src 'self'; img-src *");
t('empty policy', C.parsePolicy(''), {});
t('tolerates trailing semicolon', Object.keys(C.parsePolicy("default-src 'self';")).length, 1);

console.log('--- policy building ---');
const cur = C.parsePolicy("default-src 'self'; script-src 'self'");
const b1 = C.buildPolicy(cur, C.parseViolations(V.extScript), { inline: 'nonce', harden: false });
t('adds the blocked origin', b1['script-src'].includes('https://cdn.jsdelivr.net'), true);
t('keeps self', b1['script-src'].includes("'self'"), true);
t('does not touch unrelated directives', b1['default-src'], ["'self'"]);

const b2 = C.buildPolicy(cur, C.parseViolations(V.inlineScript), { inline: 'nonce', harden: false });
t('nonce strategy adds a nonce', b2['script-src'].some(v => v.startsWith("'nonce-")), true);
t('nonce strategy does NOT add unsafe-inline', b2['script-src'].includes("'unsafe-inline'"), false);

const b3 = C.buildPolicy(cur, C.parseViolations(V.inlineScript), { inline: 'hash', harden: false });
t('hash strategy adds a hash', b3['script-src'].some(v => v.startsWith("'sha256-")), true);

const b4 = C.buildPolicy(cur, C.parseViolations(V.inlineScript), { inline: 'unsafe', harden: false });
t('unsafe strategy adds unsafe-inline', b4['script-src'].includes("'unsafe-inline'"), true);

const b5 = C.buildPolicy(cur, C.parseViolations(V.evalStr), { inline: 'nonce', harden: false });
t('eval adds unsafe-eval', b5['script-src'].includes("'unsafe-eval'"), true);

const b6 = C.buildPolicy(C.parsePolicy("default-src 'self'; frame-src 'none'"),
  C.parseViolations(V.frame), { inline: 'nonce', harden: false });
t("adding a source removes 'none'", b6['frame-src'].includes("'none'"), false);
t('adds the frame origin', b6['frame-src'].includes('https://www.youtube.com'), true);

const b7 = C.buildPolicy(C.parsePolicy("default-src 'self'"),
  C.parseViolations(V.font), { inline: 'nonce', harden: false });
t('new directive inherits from default-src', b7['font-src'].includes("'self'"), true);
t('new directive gets the new origin', b7['font-src'].includes('https://fonts.gstatic.com'), true);

const b8 = C.buildPolicy(cur, C.parseViolations(V.extScript), { inline: 'nonce', harden: true });
t('hardening sets object-src none', b8['object-src'], ["'none'"]);
t('hardening sets base-uri', b8['base-uri'], ["'self'"]);
t('hardening sets frame-ancestors', b8['frame-ancestors'], ["'none'"]);
t('no hardening leaves them out', b1['object-src'], undefined);

console.log('--- deduplication and idempotency ---');
const twice = C.buildPolicy(cur, C.parseViolations(V.extScript + '\n' + V.extScript),
  { inline: 'nonce', harden: false });
t('same origin added once',
  twice['script-src'].filter(v => v === 'https://cdn.jsdelivr.net').length, 1);
const re = C.buildPolicy(b1, C.parseViolations(V.extScript), { inline: 'nonce', harden: false });
t('rebuilding is stable', C.serialize(re), C.serialize(b1));

console.log('--- grading ---');
const gr = p => C.grade(C.parsePolicy(p));
t('unsafe-inline is a hard fail', gr("script-src 'self' 'unsafe-inline'").issues.some(i => i[0] === 'bad'), true);
t('wildcard script-src fails', gr("script-src *").issues.some(i => i[0] === 'bad'), true);
t('data: in script-src fails', gr("script-src 'self' data:").issues.some(i => i[0] === 'bad'), true);
t('unsafe-eval warns not fails', gr("script-src 'self' 'unsafe-eval'").issues.some(i => i[0] === 'warn'), true);
t('nonce plus unsafe-inline is only a note',
  gr("script-src 'self' 'nonce-abc' 'unsafe-inline'").issues.filter(i => i[0] === 'bad').length, 0);
t('missing base-uri warns', gr("default-src 'self'").issues.some(i => i[1].includes('base-uri')), true);
t('missing frame-ancestors warns', gr("default-src 'self'").issues.some(i => i[1].includes('frame-ancestors')), true);
t('strict policy scores A',
  gr("default-src 'self'; script-src 'nonce-abc'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'").letter, 'A');
t('sloppy policy scores badly',
  ['D', 'F'].includes(gr("default-src *; script-src * 'unsafe-inline' 'unsafe-eval'").letter), true);
t('score is bounded at zero',
  gr("script-src * 'unsafe-inline' data: 'unsafe-eval'").score >= 0, true);
t('grade letters are valid',
  ['A','B','C','D','F'].includes(gr("default-src 'self'").letter), true);

console.log('--- deployment snippets ---');
const pol = "default-src 'self'; script-src 'self' https://cdn.io";
t('all stacks produce output', C.STACKS.every(s => C.deploy(s, pol, false).length > 20), true);
t('all stacks contain the policy',
  C.STACKS.filter(s => C.deploy(s, pol, false).includes("script-src 'self'")).length, C.STACKS.length);
t('header name plain', C.deploy('Header', pol, false).startsWith('Content-Security-Policy:'), true);
t('report-only switches the header name',
  C.deploy('Header', pol, true).startsWith('Content-Security-Policy-Report-Only:'), true);
t('nginx uses add_header always', C.deploy('nginx', pol, false).includes('always;'), true);
t('meta tag warns about frame-ancestors',
  C.deploy('<meta> tag', pol, false).includes('frame-ancestors'), true);
t('express escapes embedded quotes',
  C.deploy('Express', 'script-src "x"', false).includes('\\"'), true);

console.log('--- end to end ---');
const e2e = C.parseViolations([V.inlineScript, V.style, V.font].join('\n'));
const built = C.buildPolicy(C.parsePolicy("default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'"),
  e2e, { inline: 'nonce', harden: true });
const s = C.serialize(built);
t('e2e allows google fonts css', s.includes('https://fonts.googleapis.com'), true);
t('e2e allows gstatic fonts', s.includes('https://fonts.gstatic.com'), true);
t('e2e uses a nonce for inline', s.includes("'nonce-"), true);
t('e2e never emits unsafe-inline', s.includes("'unsafe-inline'"), false);
t('e2e is hardened', C.grade(built).letter, 'A');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
