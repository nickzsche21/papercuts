/* Headless tests for the backtracking regex engine.
   The core section is a differential test: my engine's match/no-match verdict
   must agree with the real JavaScript RegExp on every supported construct.
   Step counts are my own instrumentation, but correctness is not up to me. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = {
  document: { getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], createElement: () => ({ style: {} }) },
  navigator: {}, console, setTimeout, URL, Set, Map, RegExp, Math, Infinity, isFinite,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/assets/base.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/regex-backtrack/app.js', 'utf8'), sandbox);
const B = sandbox.PapercutsBacktrack;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const matches = (pat, str) => {
  const { ast } = B.parse(pat);
  return B.search(ast, str, 2000000, false).match !== null;
};
const steps = (pat, str) => {
  const { ast } = B.parse(pat);
  return B.search(ast, str, B.STEP_CAP, false).steps;
};

console.log('--- parser accepts what it claims to support ---');
const PARSES = ['abc', 'a|b', 'a*', 'a+?', 'a{2,5}', '[a-z]', '[^0-9]', '.', '^a$',
  '(a)(b)', '(?:ab)+', '(?>a+)', 'a++', '\\d\\w\\s', '\\.', 'a\\|b', '[\\]]', '\\bword\\b'];
for (const p of PARSES) {
  try { B.parse(p); pass++; } catch (e) { fail++; console.log('FAIL  cannot parse ' + p + ': ' + e.message); }
}
console.log('    ' + PARSES.length + ' patterns parsed');

console.log('--- unsupported constructs are refused, not silently wrong ---');
const REFUSE = ['(?=a)', '(?!a)', '(?<=a)b', '(a)\\1', '(a', 'a)', '[a-z'];
for (const p of REFUSE) {
  let threw = false;
  try { B.parse(p); } catch (e) { threw = true; }
  t('refuses ' + p, threw, true);
}

/* ------------------------------------------------------------------------ */
console.log('\n--- differential against the real JavaScript RegExp ---');
const CASES = [
  ['abc', ['abc', 'xabcx', 'ab', '', 'ABC']],
  ['^abc$', ['abc', 'xabc', 'abcx', '']],
  ['a*', ['', 'a', 'aaa', 'b']],
  ['a+', ['', 'a', 'aaa', 'b']],
  ['a?b', ['b', 'ab', 'aab', 'c']],
  ['a{2,3}', ['a', 'aa', 'aaa', 'aaaa']],
  ['a{3}', ['aa', 'aaa', 'aaaa']],
  ['a{2,}', ['a', 'aa', 'aaaaa']],
  ['^a|b$', ['a', 'b', 'ab', 'c', 'xa', 'bx']],
  ['[a-z]+', ['abc', 'ABC', 'a1', '123']],
  ['[^a-z]+', ['ABC', 'abc', '123']],
  ['[abc]', ['a', 'd', '']],
  ['.', ['a', '', '\n']],
  ['a.c', ['abc', 'ac', 'a\nc']],
  ['\\d+', ['123', 'abc', 'a1']],
  ['\\w+', ['ab_1', '!!!', '']],
  ['\\s', [' ', 'a', '\t']],
  ['\\D', ['a', '1']],
  ['(ab)+', ['ab', 'abab', 'a', '']],
  ['(?:ab)+c', ['abc', 'ababc', 'ac']],
  ['^(a|b)+$', ['ab', 'ba', 'abc', '']],
  ['a+?b', ['aab', 'b', 'ab']],
  ['^\\d{3}-\\d{4}$', ['555-0142', '5550142', '55-0142']],
  ['^[a-z0-9._%-]+@[a-z0-9.-]+\\.[a-z]{2,}$',
    ['ada@example.com', 'bad@@example.com', 'no-at-sign', 'a@b.co']],
  ['^(a+)+$', ['aaa', 'aaab', '']],
  ['^(a|a)*$', ['aaa', 'aaab']],
  ['colou?r', ['color', 'colour', 'colr']],
  ['^$', ['', 'a']],
  ['\\bcat\\b', ['a cat here', 'concatenate', 'cat']],
  ['^a*$', ['', 'aaa', 'aab']]
];

let agree = 0, disagree = 0;
for (const [pat, strs] of CASES) {
  for (const s of strs) {
    let mine, theirs;
    try { mine = matches(pat, s); }
    catch (e) { fail++; disagree++; console.log('FAIL  engine threw on /' + pat + '/ vs ' + JSON.stringify(s) + ': ' + e.message); continue; }
    theirs = new RegExp(pat).test(s);
    if (mine === theirs) { agree++; pass++; }
    else {
      disagree++; fail++;
      console.log('FAIL  /' + pat + '/ vs ' + JSON.stringify(s) + ': mine=' + mine + ' V8=' + theirs);
    }
  }
}
console.log('  ' + agree + ' verdicts agree with V8, ' + disagree + ' disagree');

console.log('\n--- the whole point: catastrophic backtracking is real and measured ---');
const boom20 = steps('^(a+)+$', 'a'.repeat(20) + '!');
const boom10 = steps('^(a+)+$', 'a'.repeat(10) + '!');
t('20 a-s costs vastly more than 10', boom20 > boom10 * 100, true);
t('and it is a big number', boom20 > 100000, true);
const lin20 = steps('^a+$', 'a'.repeat(20) + '!');
t('the linear version is cheap', lin20 < 200, true);
t('catastrophic is orders of magnitude worse than linear', boom20 / lin20 > 1000, true);

console.log('--- and the fixes actually defuse it ---');
const atomic = steps('^(?>a+)+$', 'a'.repeat(20) + '!');
const possessive = steps('^(a++)+$', 'a'.repeat(20) + '!');
t('atomic group collapses the work', atomic < 500, true);
t('possessive quantifier collapses the work', possessive < 500, true);
t('atomic is dramatically cheaper than the original', boom20 / atomic > 1000, true);
t('atomic still gives the right answer', matches('^(?>a+)+$', 'aaaa'), true);
t('atomic still rejects correctly', matches('^(?>a+)+$', 'aaa!'), false);
t('possessive still gives the right answer', matches('^(a++)+$', 'aaaa'), true);
t('possessive still rejects correctly', matches('^(a++)+$', 'aaa!'), false);

console.log('--- growth classification ---');
const g = (pat, str) => { const { ast } = B.parse(pat); return B.classify(B.growth(ast, str)); };
t('nested quantifier is exponential', g('^(a+)+$', 'a'.repeat(18) + '!').kind, 'exponential');
t('overlapping alternation is exponential', g('^(a|a)*$', 'a'.repeat(18) + '!').kind, 'exponential');
t('a plain pattern is linear', g('^a+$', 'a'.repeat(18) + '!').kind, 'linear');
t('a literal is linear', g('^abc$', 'abcabcabcabcabcabc').kind, 'linear');
t('exponential ratio is above 1.7', g('^(a+)+$', 'a'.repeat(18) + '!').ratio > 1.7, true);

console.log('--- the step cap protects the tab ---');
const { ast: bad } = B.parse('^(a+)+$');
const capped = B.search(bad, 'a'.repeat(60) + '!', 50000, false);
t('halts at the cap', capped.halted, true);
t('does not exceed the cap by much', capped.steps <= 50100, true);
t('reports no match when halted', capped.match, null);

console.log('--- visit heatmap ---');
const vis = B.search(B.parse('^(a+)+$').ast, 'aaaaaaaa!', 2000000, true);
t('visits array is the right length', vis.visits.length, 10);
t('some position is hammered', Math.max(...vis.visits) > 50, true);
t('total visits equal total steps', vis.visits.reduce((a, b) => a + b, 0), vis.steps);

console.log('--- projection and formatting ---');
t('linear growth is not projected',
  B.project([{ n: 1, steps: 1 }, { n: 2, steps: 2 }], { kind: 'linear', ratio: 1 }, 40), null);
t('sub-millisecond', B.humanTime(1000), 'under a millisecond');
t('seconds', B.humanTime(5e8), '10.0 seconds');
t('huge is described, not printed', B.humanTime(Infinity), 'longer than the age of the universe');
t('years for a big number', /years/.test(B.humanTime(1e25)), true);

console.log('--- fix suggestions ---');
const fixes = B.suggestFixes('^(a+)+$');
t('suggests two fixes for the classic', fixes.length, 2);
t('atomic suggestion parses', (() => { try { B.parse(fixes[0].pattern); return true; } catch (e) { return false; } })(), true);
t('possessive suggestion parses', (() => { try { B.parse(fixes[1].pattern); return true; } catch (e) { return false; } })(), true);
t('atomic suggestion is actually fast', steps(fixes[0].pattern, 'a'.repeat(20) + '!') < 500, true);
t('possessive suggestion is actually fast', steps(fixes[1].pattern, 'a'.repeat(20) + '!') < 500, true);
t('atomic suggestion agrees with the original on a match',
  matches(fixes[0].pattern, 'aaaa'), matches('^(a+)+$', 'aaaa'));
t('no fix suggested for a safe pattern', B.suggestFixes('^[a-z]+$').length, 0);

console.log('--- every preset on the page behaves as advertised ---');
const PRESETS = [
  ['^(a+)+$', 'aaaaaaaaaaaaaaaaaaaa!', 'exponential'],
  ['^(a|a)*$', 'aaaaaaaaaaaaaaaaaaaa!', 'exponential'],
  ['^(?>a+)+$', 'aaaaaaaaaaaaaaaaaaaa!', 'linear'],
  ['^(a++)+$', 'aaaaaaaaaaaaaaaaaaaa!', 'linear'],
  ['^[a-z0-9._%-]+@[a-z0-9.-]+\\.[a-z]{2,}$', 'ada@example.com', 'linear'],
  ['^\\d{3}-\\d{4}$', '555-0142', 'linear']
];
for (const [pat, str, kind] of PRESETS) {
  try {
    const k = g(pat, str).kind;
    if (k === kind) pass++;
    else { fail++; console.log('FAIL  preset /' + pat + '/ classified ' + k + ', expected ' + kind); }
  } catch (e) { fail++; console.log('FAIL  preset /' + pat + '/ threw: ' + e.message); }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
