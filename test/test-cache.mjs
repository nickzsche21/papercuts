/* Headless tests for the Cache-Control simulator. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = {
  document: { getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], createElement: () => ({ style: {} }) },
  navigator: {}, console, setTimeout, URL, Set, Map, Date,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/assets/base.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/cache-control/app.js', 'utf8'), sandbox);
const C = sandbox.PapercutsCache;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const A = s => C.analyse(s);
const warnIds = s => A(s).warnings.map(w => w.title);
const hasWarn = (s, frag) => A(s).warnings.some(w => (w.title + ' ' + w.why).toLowerCase().includes(frag.toLowerCase()));

console.log('--- header parsing ---');
t('bare directive list', C.parseHeaders('public, max-age=60')['cache-control'], 'public, max-age=60');
t('named header', C.parseHeaders('Cache-Control: max-age=60')['cache-control'], 'max-age=60');
t('case insensitive name', C.parseHeaders('CACHE-CONTROL: max-age=60')['cache-control'], 'max-age=60');
t('multiple headers', Object.keys(C.parseHeaders('Cache-Control: max-age=1\nETag: "x"')).sort(), ['cache-control', 'etag']);
t('repeated header joined', C.parseHeaders('Vary: A\nVary: B')['vary'], 'A, B');
t('empty input', Object.keys(C.parseHeaders('')).length, 0);

console.log('--- directive parsing ---');
t('numeric directive', C.parseCC('max-age=3600')['max-age'], 3600);
t('boolean directive', C.parseCC('no-store')['no-store'], true);
t('multiple', C.parseCC('public, max-age=60, immutable').present.sort(), ['immutable', 'max-age', 'public']);
t('quoted value tolerated', C.parseCC('max-age="60"')['max-age'], 60);
t('whitespace tolerated', C.parseCC('  public ,  max-age = 60 ')['max-age'], 60);
t('typo goes to unknown', C.parseCC('max_age=60').unknown, ['max_age=60']);
t('unknown does not become a directive', C.parseCC('maxage=60')['max-age'], undefined);
t('case insensitive directive', C.parseCC('MAX-AGE=60')['max-age'], 60);
t('zero preserved', C.parseCC('max-age=0')['max-age'], 0);

console.log('--- freshness lifetime ---');
t('max-age drives both', [A('max-age=600').browserTTL, A('max-age=600').sharedTTL], [600, 600]);
t('s-maxage overrides shared only',
  [A('max-age=60, s-maxage=600').browserTTL, A('max-age=60, s-maxage=600').sharedTTL], [60, 600]);
t('private zeroes shared', A('public, max-age=600, private').sharedTTL, 0);
t('no-cache zeroes browser', A('no-cache, max-age=600').browserTTL, 0);
t('no-store zeroes both', [A('no-store').browserTTL, A('no-store').sharedTTL], [0, 0]);
t('source is max-age', A('max-age=60').ttlSource, 'max-age');
t('no directives at all has no ttl', A('Cache-Control: public').browserTTL, null);

console.log('--- heuristic caching (the silent default) ---');
const heur = A('Last-Modified: Wed, 01 Jan 2020 10:00:00 GMT');
t('heuristic source detected', heur.ttlSource, 'heuristic');
t('heuristic ttl is positive', heur.browserTTL > 0, true);
t('heuristic is flagged as a problem', hasWarn('Last-Modified: Wed, 01 Jan 2020 10:00:00 GMT', 'heuristic'), true);
t('no heuristic when no-cache present',
  A('Cache-Control: no-cache\nLast-Modified: Wed, 01 Jan 2020 10:00:00 GMT').ttlSource, 'no-cache');

console.log('--- storable / shareable ---');
t('no-store not storable', A('no-store').storable, false);
t('normal is storable', A('max-age=60').storable, true);
t('private not shareable', A('private, max-age=60').shareable, false);
t('public is shareable', A('public, max-age=60').shareable, true);
t('no-cache is still storable', A('no-cache').storable, true);

console.log('--- contradiction detection ---');
t('no-store cancels the rest', hasWarn('no-store, max-age=3600, public', 'cancels the rest'), true);
t('no-cache overrides max-age', hasWarn('no-cache, max-age=3600', 'overrides your max-age'), true);
t('no-cache without validator', hasWarn('no-cache', 'no ETag or Last-Modified'), true);
t('no-cache WITH validator is not flagged',
  hasWarn('Cache-Control: no-cache\nETag: "abc"', 'no ETag or Last-Modified'), false);
t('must-revalidate alone is inert', hasWarn('must-revalidate', 'nothing to act on'), true);
t('must-revalidate with max-age is fine', hasWarn('max-age=60, must-revalidate', 'nothing to act on'), false);
t('private + s-maxage contradiction', hasWarn('private, s-maxage=600', 'contradict'), true);
t('max-age beats Expires',
  hasWarn('Cache-Control: max-age=60\nExpires: Wed, 01 Jan 2031 10:00:00 GMT', 'Expires is being ignored'), true);
t('immutable with short max-age', hasWarn('max-age=60, immutable', 'immutable with a short max-age'), true);
t('immutable with long max-age is fine', hasWarn('max-age=31536000, immutable', 'immutable with a short'), false);
t('no instructions at all', hasWarn('ETag: "x"', 'No caching instructions'), true);
t('Vary star', hasWarn('Cache-Control: max-age=60\nVary: *', 'uncacheable'), true);
t('already stale via Age', hasWarn('Cache-Control: max-age=60\nAge: 600', 'already stale'), true);
t('Age within ttl is fine', hasWarn('Cache-Control: max-age=600\nAge: 60', 'already stale'), false);
t('Pragma noted as inert', hasWarn('Cache-Control: max-age=60\nPragma: no-cache', 'Pragma'), true);
t('typo directive flagged', hasWarn('max_age=60, public', 'Unrecognised'), true);
t('over a year noted', hasWarn('max-age=99999999', 'above one year'), true);
t('public with Authorization',
  hasWarn('Cache-Control: public, max-age=60\nAuthorization: Bearer x', 'authorised request'), true);

console.log('--- clean headers produce no hard failures ---');
const clean = 'Cache-Control: public, max-age=31536000, immutable';
t('hashed asset has no bad warnings', A(clean).warnings.filter(w => w.sev === 'bad').length, 0);
const cleanApi = 'Cache-Control: public, max-age=60, stale-while-revalidate=300\nETag: "abc"';
t('api preset has no bad warnings', A(cleanApi).warnings.filter(w => w.sev === 'bad').length, 0);
t('no-store alone has no bad warnings', A('no-store').warnings.filter(w => w.sev === 'bad').length, 0);

console.log('--- scenarios ---');
const scn = s => A(s).scenarios.map(x => x.name + '|' + x.kind);
t('no-store never uses cache', A('no-store').scenarios.every(s => s.kind === 'net'), true);
t('fresh revisit is served from cache',
  A('max-age=600').scenarios.some(s => s.kind === 'cache' && /Revisit within/.test(s.name)), true);
t('expired revisit revalidates when validator present',
  A('Cache-Control: max-age=600\nETag: "x"').scenarios.some(s => s.kind === 'reval' && /after/.test(s.name)), true);
t('expired revisit re-downloads without validator',
  A('max-age=600').scenarios.some(s => s.kind === 'net' && /after/.test(s.name)), true);
t('swr adds a scenario', A('max-age=60, stale-while-revalidate=300').scenarios.some(s => /Just after expiry/.test(s.name)), true);
t('stale-if-error adds a scenario', A('max-age=60, stale-if-error=86400').scenarios.some(s => /Origin is down/.test(s.name)), true);
t('reload scenario always present', A('max-age=60').scenarios.some(s => /Normal reload/.test(s.name)), true);
t('cdn scenario always present', A('max-age=60').scenarios.some(s => /Shared CDN/.test(s.name)), true);
t('private cdn scenario is network', A('private, max-age=60').scenarios.find(s => /Shared CDN/.test(s.name)).kind, 'net');
t('public cdn scenario is cache', A('public, max-age=600').scenarios.find(s => /Shared CDN/.test(s.name)).kind, 'cache');
t('every scenario has a known kind',
  A('max-age=60, stale-while-revalidate=30').scenarios.every(s => ['net', 'cache', 'reval'].includes(s.kind)), true);

console.log('--- duration formatting ---');
t('seconds', C.dur(30), '30 seconds');
t('one minute', C.dur(60), '1 minute');
t('an hour', C.dur(3600), '1 hour');
t('a day', C.dur(86400), '1 day');
t('a year', C.dur(31536000), '1 year');
t('zero', C.dur(0), '0 seconds');
t('null', C.dur(null), null);

console.log('--- every preset analyses without throwing ---');
C.PRESETS.forEach(p => {
  try {
    const r = A(p[1]);
    if (!r.scenarios.length) { fail++; console.log('FAIL  preset has no scenarios: ' + p[0]); }
    else pass++;
  } catch (e) { fail++; console.log('FAIL  preset threw: ' + p[0] + ' — ' + e.message); }
});
t('contradictory preset is flagged',
  A(C.PRESETS[7][1]).warnings.filter(w => w.sev === 'bad').length > 0, true);

console.log('--- no-store suppresses moot no-cache noise ---');
t('no-store hides the no-cache validator warning', hasWarn('no-store, no-cache', 'no-cache with no ETag'), false);
t('no-store hides the max-age override warning', hasWarn('no-store, no-cache, max-age=60', 'overrides your max-age'), false);
t('no-store still reports it cancels the rest', hasWarn('no-store, no-cache, max-age=60', 'cancels the rest'), true);
t('without no-store the no-cache warning still fires', hasWarn('no-cache', 'no-cache with no ETag'), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
