/* Headless tests for the regex portability checker.
   The last section verifies the JavaScript column against the real V8 engine. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = {
  document: { getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], createElement: () => ({ style: {} }) },
  navigator: {}, console, setTimeout, URL, Set, Map, RegExp,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/assets/base.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/regex-flavours/app.js', 'utf8'), sandbox);
const R = sandbox.PapercutsRegex;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const has = (p, id) => !!R.detect(p)[id];
const feats = p => Object.keys(R.detect(p)).sort();

console.log('--- feature detection ---');
t('lookahead', has('a(?=b)', 'lookahead'), true);
t('negative lookahead', has('a(?!b)', 'lookahead'), true);
t('lookbehind', has('(?<=a)b', 'lookbehind'), true);
t('negative lookbehind', has('(?<!a)b', 'lookbehind'), true);
t('numeric backref', has('(a)\\1', 'backref'), true);
t('named backref \\k', has('(?<n>a)\\k<n>', 'backref'), true);
t('python named backref', has('(?P<n>a)(?P=n)', 'backref'), true);
t('named group angle', has('(?<year>\\d+)', 'namedAngle'), true);
t('named group quote', has("(?'year'\\d+)", 'namedAngle'), true);
t('named group python', has('(?P<year>\\d+)', 'namedP'), true);
t('atomic group', has('(?>a+)', 'atomic'), true);
t('possessive star', has('a*+', 'possessive'), true);
t('possessive plus', has('a++', 'possessive'), true);
t('possessive brace', has('a{2,3}+', 'possessive'), true);
t('recursion (?R)', has('a(?R)b', 'recursion'), true);
t('recursion \\g', has('a\\g<0>b', 'recursion'), true);
t('conditional', has('(a)?(?(1)b|c)', 'conditional'), true);
t('keepout', has('foo\\Kbar', 'keepout'), true);
t('unicode property', has('\\p{L}+', 'uniprop'), true);
t('inline flags global', has('(?i)abc', 'inlineGlobal'), true);
t('inline flags scoped', has('(?i:abc)d', 'inlineScoped'), true);
t('inline comment', has('a(?#note)b', 'comment'), true);
t('string anchors', has('\\Aabc\\z', 'anchorAZ'), true);
t('horizontal space', has('a\\hb', 'hspace'), true);
t('branch reset', has('(?|(a)|(b))', 'branchReset'), true);

console.log('--- must NOT false-positive ---');
t('plain pattern has no features', feats('^[a-z0-9._%-]+@[a-z0-9.-]+\\.[a-z]{2,}$'), []);
t('lookahead inside a class is literal', has('[(?=]', 'lookahead'), false);
t('backref digit inside a class', has('[\\1]', 'backref'), false);
t('escaped paren is not a group', has('\\(\\?=x', 'lookahead'), false);
t('escaped backslash then digit is not a backref', has('a\\\\1', 'backref'), false);
t('non-capturing group is not named', has('(?:abc)', 'namedAngle'), false);
t('plain quantifier is not possessive', has('a+b*', 'possessive'), false);
t('lazy quantifier is not possessive', has('a+?b*?', 'possessive'), false);
t('caret and dollar are not \\A \\z', has('^abc$', 'anchorAZ'), false);
t('class with escaped bracket', feats('[a-z\\]]+'), []);

console.log('--- variable-length lookbehind ---');
t('fixed width is not variable', R.isVariableWidth('abc'), false);
t('star makes it variable', R.isVariableWidth('a*'), true);
t('plus makes it variable', R.isVariableWidth('a+'), true);
t('optional makes it variable', R.isVariableWidth('ab?'), true);
t('bounded range is variable', R.isVariableWidth('a{2,5}'), true);
t('exact repeat is fixed', R.isVariableWidth('a{3}'), false);
t('equal alternatives are fixed', R.isVariableWidth('ab|cd'), false);
t('unequal alternatives are variable', R.isVariableWidth('foo|foobar'), true);
t('detected end to end', has('(?<=foo|foobar)x', 'varlookbehind'), true);
t('fixed lookbehind is not flagged variable', has('(?<=abc)x', 'varlookbehind'), false);

console.log('--- verdicts ---');
const plain = R.analyse('^[a-z]+@[a-z]+\\.[a-z]{2,}$');
t('plain pattern uses no special features', plain.used.length, 0);
t('plain pattern works in every engine', plain.engines.every(e => e.status === 'y'), true);
const lb = R.analyse('(?<=\\$)\\d+');
t('lookbehind breaks Go', lb.engines.find(e => e.engine.id === 'go').status, 'n');
t('lookbehind breaks Rust', lb.engines.find(e => e.engine.id === 'rust').status, 'n');
t('lookbehind is fine in .NET', lb.engines.find(e => e.engine.id === 'dotnet').status, 'y');
t('lookbehind is partial in Python', lb.engines.find(e => e.engine.id === 'py').status, 'p');
const br = R.analyse('\\b(\\w+)\\s+\\1\\b');
t('backreference breaks Go', br.engines.find(e => e.engine.id === 'go').status, 'n');
t('backreference is fine in PCRE', br.engines.find(e => e.engine.id === 'pcre').status, 'y');
t('every feature has a row for every engine',
  R.FEATURES.every(f => R.ENGINES.every(e => ['y', 'n', 'p'].includes(f.s[e.id]))), true);
t('every feature has a why and a fix',
  R.FEATURES.every(f => f.why && f.fix && f.why.length > 20), true);

console.log('--- translation ---');
t('angle to python', R.translate('(?<year>\\d{4})', 'py'), '(?P<year>\\d{4})');
t('python to angle', R.translate('(?P<year>\\d{4})', 'js'), '(?<year>\\d{4})');
t('named backref to python', R.translate('(?<n>a)\\k<n>', 'py'), '(?P<n>a)(?P=n)');
t('python backref to angle', R.translate('(?P<n>a)(?P=n)', 'js'), '(?<n>a)\\k<n>');
t('no-op when nothing to change', R.translate('^[a-z]+$', 'py'), '^[a-z]+$');
t('round trip is stable', R.translate(R.translate('(?<a>x)', 'py'), 'js'), '(?<a>x)');

console.log('--- ReDoS heuristic ---');
t('nested quantifier flagged', R.redosRisk('^(a+)+$').length > 0, true);
t('overlapping alternation flagged', R.redosRisk('^(a|a)*$').length > 0, true);
t('simple quantifier not flagged', R.redosRisk('^a+b+$').length, 0);
/* Regression: an earlier heuristic flagged ordinary email patterns. A false
   alarm here is worse than a miss, because it teaches people to ignore it. */
t('safe email pattern not flagged', R.redosRisk('^[a-z]+@[a-z]+$').length, 0);
t('full email pattern not flagged', R.redosRisk('^[a-z0-9._%-]+@[a-z0-9.-]+\\.[a-z]{2,}$').length, 0);
t('url pattern not flagged', R.redosRisk('https?://[^/]+/[a-z]+').length, 0);
t('adjacent identical shorthand flagged', R.redosRisk('\\w+\\w+').length > 0, true);
t('adjacent identical classes flagged', R.redosRisk('[a-z]+[a-z]+').length > 0, true);

/* ---------------------------------------------------------------------- */
console.log('\n--- verifying the JavaScript column against real V8 ---');
/* Tested with the u flag, under which an unsupported escape is a hard error
   rather than being silently reinterpreted as a literal character. */
const JS_CASES = [
  ['lookahead',     'a(?=b)',      'y'],
  ['lookbehind',    '(?<=a)b',     'y'],
  ['varlookbehind', '(?<=a|bcd)e', 'y'],
  ['backref',       '(a)\\1',      'y'],
  ['namedAngle',    '(?<n>a)',     'y'],
  ['namedP',        '(?P<n>a)',    'n'],
  ['atomic',        '(?>a)',       'n'],
  ['possessive',    'a++',         'n'],
  ['recursion',     '(?R)',        'n'],
  ['conditional',   '(?(1)a|b)',   'n'],
  ['keepout',       'a\\Kb',       'n'],
  ['inlineGlobal',  '(?i)abc',     'n'],
  ['inlineScoped',  '(?i:abc)',    'n'],
  ['comment',       'a(?#x)b',     'n'],
  ['anchorAZ',      '\\Aabc',      'n'],
  ['hspace',        'a\\hb',       'n'],
  ['branchReset',   '(?|(a)|(b))', 'n']
];

let agree = 0, disagree = 0;
for (const [id, sample, claimed] of JS_CASES) {
  let compiles;
  try { new RegExp(sample, 'u'); compiles = true; }
  catch (e) { compiles = false; }
  const feature = R.FEATURES.find(f => f.id === id);
  t('table says ' + claimed + ' for ' + id, feature ? feature.s.js : '?', claimed);
  const expected = claimed === 'y';
  if (compiles === expected) { agree++; pass++; }
  else {
    disagree++; fail++;
    console.log('FAIL  V8 disagrees on ' + id + ' (' + sample + '): compiles=' + compiles +
      ' but the table claims ' + claimed);
  }
}
console.log('  ' + agree + ' constructs verified against V8, ' + disagree + ' disagree');

console.log('--- why \\p{L} is marked partial in JavaScript ---');
t('it compiles without the u flag', (() => { try { new RegExp('\\p{L}'); return true; } catch (e) { return false; } })(), true);
/* but it means something completely different: \p is an identity escape, so the
   pattern is the literal text p{L}. Compiling is exactly what makes it dangerous. */
t('without u it silently means a literal', new RegExp('\\p{L}').test('p{L}'), true);
t('and does not match a letter', new RegExp('\\p{L}').test('x'), false);
t('with u it matches any letter', new RegExp('\\p{L}', 'u').test('x'), true);
t('table marks it partial', R.FEATURES.find(f => f.id === 'uniprop').s.js, 'p');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
