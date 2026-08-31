/* Headless tests for the CORS error decoder. */
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
vm.runInContext(fs.readFileSync(ROOT + '/cors/app.js', 'utf8'), sandbox);
const C = sandbox.PapercutsCORS;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const id = s => { const h = C.diagnose(s); return h ? h.rule.id : null; };
const blame = s => { const h = C.diagnose(s); return h ? h.rule.blame : null; };

/* Real browser strings. */
const E = {
  noAcao: "Access to fetch at 'https://api.example.com/v1/me' from origin 'https://app.example.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
  wildcardCred: "Access to XMLHttpRequest at 'https://api.example.com/session' from origin 'https://app.example.com' has been blocked by CORS policy: The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.",
  preflightStatus: "Access to fetch at 'https://api.example.com/orders' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.",
  headerNotAllowed: "Access to fetch at 'https://api.example.com/orders' from origin 'http://localhost:5173' has been blocked by CORS policy: Request header field authorization is not allowed by Access-Control-Allow-Headers in preflight response.",
  methodNotAllowed: "Access to fetch at 'https://api.example.com/orders/12' from origin 'https://app.example.com' has been blocked by CORS policy: Method PATCH is not allowed by Access-Control-Allow-Methods in preflight response.",
  originMismatch: "Access to fetch at 'https://api.example.com/v1/me' from origin 'http://localhost:3000' has been blocked by CORS policy: The 'Access-Control-Allow-Origin' header has a value 'https://app.example.com' that is not equal to the supplied origin.",
  multiple: "Access to fetch at 'https://api.example.com/v1/me' from origin 'https://app.example.com' has been blocked by CORS policy: The 'Access-Control-Allow-Origin' header contains multiple values '*, *', but only one is allowed.",
  preflightRedirect: "Access to fetch at 'https://api.example.com/orders' from origin 'https://app.example.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: Redirect is not allowed for a preflight request.",
  credNotTrue: "Access to fetch at 'https://api.example.com/me' from origin 'https://app.example.com' has been blocked by CORS policy: Credentials flag is 'true', but the 'Access-Control-Allow-Credentials' header is ''. It must be 'true' to allow credentials.",
  scheme: "Access to fetch at 'https://api.example.com/x' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: http, data, isolated-app, chrome-extension, chrome, https, chrome-untrusted.",
  ffMissing: "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://api.example.com/v1/me. (Reason: CORS header 'Access-Control-Allow-Origin' missing).",
  ffDidNotSucceed: "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://localhost:8443/api. (Reason: CORS request did not succeed). Status code: (null)",
  ffHeaderNotAllowed: "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://api.example.com/orders. (Reason: header 'authorization' is not allowed according to header 'Access-Control-Allow-Headers' from CORS preflight response).",
  ffCredWildcard: "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://api.example.com/me. (Reason: Credential is not supported if the CORS header 'Access-Control-Allow-Origin' is '*').",
  safariOrigin: "Origin https://app.example.com is not allowed by Access-Control-Allow-Origin. Status code: 200",
  safariPreflight: "Preflight response is not successful. Status code: 401",
  redirectBlocked: "Access to fetch at 'https://api.example.com/x' from origin 'https://app.example.com' has been blocked by CORS policy: Redirect has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
  privateNet: "Access to fetch at 'http://192.168.1.50/api' from origin 'https://app.example.com' has been blocked by CORS policy: The request client is not a secure context and the resource is in more-private address space `private`.",
};

console.log('--- classification: Chrome ---');
t('no ACAO', id(E.noAcao), 'no-acao');
t('wildcard + credentials', id(E.wildcardCred), 'wildcard-credentials');
t('preflight not ok', id(E.preflightStatus), 'preflight-not-ok');
t('header not allowed', id(E.headerNotAllowed), 'header-not-allowed');
t('method not allowed', id(E.methodNotAllowed), 'method-not-allowed');
t('origin mismatch', id(E.originMismatch), 'origin-mismatch');
t('multiple values', id(E.multiple), 'multiple-values');
t('preflight redirect', id(E.preflightRedirect), 'preflight-redirect');
t('credentials not true', id(E.credNotTrue), 'credentials-not-true');
t('bad scheme', id(E.scheme), 'scheme');
t('private network', id(E.privateNet), 'private-network');
t('redirect blocked', id(E.redirectBlocked), 'redirect-blocked');

console.log('--- classification: Firefox and Safari ---');
t('firefox missing header', id(E.ffMissing), 'no-acao');
t('firefox request did not succeed', id(E.ffDidNotSucceed), 'network');
t('firefox header not allowed', id(E.ffHeaderNotAllowed), 'header-not-allowed');
t('firefox credential wildcard', id(E.ffCredWildcard), 'wildcard-credentials');
t('safari origin not allowed', id(E.safariOrigin), 'origin-mismatch');
t('safari preflight failed', id(E.safariPreflight), 'preflight-not-ok');

console.log('--- specificity: more specific rule must win ---');
t('preflight+noACAO is not plain no-acao',
  id("Access to fetch at 'https://a.com/x' from origin 'https://b.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource."),
  'preflight-no-acao');
t('network beats generic blocked wording', id(E.ffDidNotSucceed), 'network');

console.log('--- blame attribution ---');
t('no ACAO blames server', blame(E.noAcao), 'server');
t('bad scheme blames client', blame(E.scheme), 'client');
t('failed request is network', blame(E.ffDidNotSucceed), 'network');
t('wildcard+cred blames server', blame(E.wildcardCred), 'server');

console.log('--- extraction ---');
t('origin from chrome', C.extract(E.noAcao).origin, 'https://app.example.com');
t('target from chrome', C.extract(E.noAcao).target, 'https://api.example.com/v1/me');
t('localhost origin with port', C.extract(E.preflightStatus).origin, 'http://localhost:3000');
t('origin from firefox target', C.extract(E.ffMissing).target, 'https://api.example.com/v1/me');
t('origin from safari', C.extract(E.safariOrigin).origin, 'https://app.example.com');
t('status code parsed', C.extract(E.safariPreflight).status, 401);
t('browser chrome', C.extract(E.noAcao).browser, 'Chrome or Edge');
t('browser firefox', C.extract(E.ffMissing).browser, 'Firefox');
t('browser safari', C.extract(E.safariPreflight).browser, 'Safari');
t('preflight flag set', C.extract(E.preflightStatus).preflight, true);
t('preflight flag clear', C.extract(E.noAcao).preflight, false);
t('server origin derived', C.originOf(C.extract(E.noAcao).target), 'https://api.example.com');

console.log('--- captured values ---');
t('captures blocked header', C.diagnose(E.headerNotAllowed).header, 'authorization');
t('captures blocked method', C.diagnose(E.methodNotAllowed).method, 'PATCH');
t('captures firefox header', C.diagnose(E.ffHeaderNotAllowed).header, 'authorization');
t('captures what server allows', C.diagnose(E.originMismatch).serverSays, 'https://app.example.com');

console.log('--- non-CORS input is rejected ---');
t('empty', C.diagnose(''), null);
t('unrelated text', C.diagnose('TypeError: undefined is not a function'), null);
t('404 message', C.diagnose('GET https://api.example.com/x 404 (Not Found)'), null);
t('random prose', C.diagnose('the quick brown fox jumps over the lazy dog'), null);

console.log('--- preflight predictor ---');
const pf = s => C.preflightNeeded(s).preflight;
t('simple GET no preflight', pf({ method: 'GET', contentType: '', headers: [] }), false);
t('POST form no preflight', pf({ method: 'POST', contentType: 'application/x-www-form-urlencoded', headers: [] }), false);
t('POST text/plain no preflight', pf({ method: 'POST', contentType: 'text/plain', headers: [] }), false);
t('POST json DOES preflight', pf({ method: 'POST', contentType: 'application/json', headers: [] }), true);
t('PUT always preflights', pf({ method: 'PUT', contentType: '', headers: [] }), true);
t('DELETE always preflights', pf({ method: 'DELETE', contentType: '', headers: [] }), true);
t('PATCH always preflights', pf({ method: 'PATCH', contentType: '', headers: [] }), true);
t('custom header preflights', pf({ method: 'GET', contentType: '', headers: ['Authorization'] }), true);
t('safelisted header does not', pf({ method: 'GET', contentType: '', headers: ['Accept'] }), false);
t('content-type header name is safelisted', pf({ method: 'GET', contentType: '', headers: ['Content-Type'] }), false);
t('charset suffix tolerated', pf({ method: 'POST', contentType: 'text/plain; charset=utf-8', headers: [] }), false);
t('json with charset preflights', pf({ method: 'POST', contentType: 'application/json; charset=utf-8', headers: [] }), true);
t('reason given for json', C.preflightNeeded({ method: 'POST', contentType: 'application/json', headers: [] }).reasons.length, 1);

console.log('--- config generation ---');
const cfg = { origin: 'https://app.example.com', credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'PATCH'], headers: ['Authorization', 'Content-Type'],
  expose: [], privateNetwork: false };
t('all stacks produce output', C.STACKS.every(s => gen0(s).length > 60), true);
function gen0(s) { return C.gen(s, cfg); }
/* Apache escapes the origin into a regex for SetEnvIf, so compare unescaped. */
const unesc = s => gen0(s).replace(/\\(?=[.\-])/g, '');
t('every stack embeds the real origin',
  C.STACKS.filter(s => unesc(s).includes('app.example.com')).length, C.STACKS.length);
t('apache escapes the origin for its regex matcher',
  gen0('Apache').includes('app\\.example\\.com'), true);
t('nginx repeats headers inside the if block',
  (gen0('nginx').match(/Access-Control-Allow-Origin/g) || []).length >= 2, true);
t('nginx sets Vary Origin', gen0('nginx').includes('Vary'), true);
t('express warns about middleware order', gen0('Express').toLowerCase().includes('auth'), true);
t('django warns about middleware position', gen0('Django').includes('CorsMiddleware'), true);
t('spring mentions security chain', gen0('Spring Boot').toLowerCase().includes('security'), true);
t('aspnet gets UseCors ordering right',
  gen0('ASP.NET Core').indexOf('UseCors') < gen0('ASP.NET Core').indexOf('UseAuthorization'), true);
t('cloudfront note about forwarding Origin',
  gen0('S3 + CloudFront').toLowerCase().includes('forward'), true);
t('credentials true emits the credentials header',
  gen0('nginx').includes('Access-Control-Allow-Credentials'), true);
const noCred = Object.assign({}, cfg, { credentials: false });
t('no credentials omits the credentials header',
  C.gen('nginx', noCred).includes('Allow-Credentials'), false);
t('placeholder origin when none parsed',
  C.gen('Express', Object.assign({}, cfg, { origin: null })).includes('your-app.example.com'), true);
t('expose headers appear when needed',
  C.gen('Express', Object.assign({}, cfg, { expose: ['X-Total-Count'] })).includes('X-Total-Count'), true);
t('private network header when needed',
  C.gen('nginx', Object.assign({}, cfg, { privateNetwork: true })).includes('Allow-Private-Network'), true);

console.log('--- every rule is reachable and well formed ---');
t('all rules have steps', C.RULES.every(r => r.steps && r.steps.length > 0), true);
t('all rules have a blame', C.RULES.every(r => ['server', 'client', 'network'].includes(r.blame)), true);
t('all rules have an explanation', C.RULES.every(r => r.what && r.what.length > 40), true);
t('rule ids are unique', new Set(C.RULES.map(r => r.id)).size, C.RULES.length);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
