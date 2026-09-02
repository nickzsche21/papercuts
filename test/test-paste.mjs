/* Headless tests for the paste damage simulator. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = {
  document: { getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], createElement: () => ({ style: {} }) },
  navigator: {}, console, setTimeout, URL, Set, Map, RegExp, Number,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/assets/base.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/paste-damage/app.js', 'utf8'), sandbox);
const P = sandbox.PapercutsPaste;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const via = (id, text) => P.DESTINATIONS.find(d => d.id === id).run(text).out;
const verdictOf = (id, text) => {
  const r = P.analyse(text).find(x => x.dest.id === id);
  return r.verdict.level;
};

console.log('--- Word / Outlook autocorrect ---');
/* Word autocapitalises too, so every expectation below starts with a capital. */
t('apostrophe becomes a right single quote', via('word', "don't"), 'Don’t');
t('opening single quote curls open', via('word', "say 'hi'"), 'Say ‘hi’');
t('double quotes curl', via('word', 'say "hi"'), 'Say “hi”');
t('double hyphen between words becomes an em dash', via('word', 'flag--value'), 'Flag—value');
t('spaced hyphen becomes an en dash', via('word', 'a - b'), 'A – b');
t('three dots become an ellipsis', via('word', 'wait...'), 'Wait…');
t('(c) becomes copyright', via('word', '(c) 2026'), '© 2026');
t('ascii arrow becomes a glyph', via('word', 'a -> b'), 'A → b');
t('first letter capitalised', via('word', 'curl x'), 'Curl x');

console.log('--- the flag-breaking case, end to end ---');
const CURL = "curl -X POST --header 'Content-Type: application/json' https://api.example.com";
const wordCurl = via('word', CURL);
/* Word only converts a double hyphen with text on BOTH sides, so " --header"
   survives. Asserting otherwise was drama, not behaviour. */
t('a space-prefixed flag survives Word', wordCurl.includes('--header'), true);
t('but a double hyphen between words does convert', via('word', 'a--b'), 'A—b');
t('curl loses its straight quotes', wordCurl.includes("'"), false);
t('and is judged fatal', verdictOf('word', CURL), 'fatal');

console.log('--- Slack eats markdown ---');
t('underscores are consumed', via('slack', 'my _var_ name'), 'my var name');
t('asterisks are consumed', via('slack', 'the *bold* one'), 'the bold one');
t('tildes are consumed', via('slack', 'a ~b~ c'), 'a b c');
t('emoticon becomes emoji', via('slack', 'ok :)'), 'ok \u{1F642}');
t('slack does NOT curl quotes', via('slack', "don't"), "don't");
t('slack leaves a double hyphen alone', via('slack', 'npm i --save'), 'npm i --save');
t('deleting text is judged fatal', verdictOf('slack', 'the *bold* one'), 'fatal');

console.log('--- Jira, the underscore eater ---');
t('underscores removed', via('jira', 'call _my_ method'), 'call my method');
t('braces removed', via('jira', 'use {code} here'), 'use  here');
t('link loses its target', via('jira', 'see [docs|http://x.com] now'), 'see docs now');

console.log('--- PDF extraction ---');
t('fi ligature', via('pdf', 'define'), 'deﬁne');
t('fl ligature', via('pdf', 'workflow'), 'workﬂow');
t('spaces become non-breaking', via('pdf', 'a b').charCodeAt(1), 0x00A0);
t('pdf damage is fatal', verdictOf('pdf', 'define the workflow'), 'fatal');

console.log('--- Excel coercion ---');
t('leading equals becomes a formula', via('excel', '=SUM(A1)'), '#NAME?');
t('leading plus becomes a formula', via('excel', '+1 555 0100'), '#NAME?');
t('leading at becomes a formula', via('excel', '@handle'), '#NAME?');
t('a negative number is left alone', via('excel', '-42'), '-42');
t('long digits go scientific', via('excel', '1234567890123'), '1.23457E+12');
t('normal text is untouched', via('excel', 'hello'), 'hello');

console.log('--- must NOT false-positive ---');
t('plain lowercase text survives Slack', via('slack', 'hello world'), 'hello world');
t('a safe command survives Slack', via('slack', 'ls -la /tmp'), 'ls -la /tmp');
t('plain text is safe in Slack', verdictOf('slack', 'hello world'), 'safe');
t('plain text is safe in Jira', verdictOf('jira', 'hello world'), 'safe');
t('text with no quotes or dashes survives Word',
  via('word', 'Hello world'), 'Hello world');
t('a single hyphenated flag survives Word', via('word', 'ls -la').includes('–'), false);
t('a double-hyphen flag after a space survives Word', via('word', 'npm i --save'), 'Npm i --save');
t('snake_case survives Word', via('word', 'my_var_name'), 'My_var_name');

console.log('--- verdicts ---');
t('unchanged means safe', P.verdict('abc', { out: 'abc' }).level, 'safe');
t('lookalike substitution is fatal', P.verdict('a-b', { out: 'a–b' }).level, 'fatal');
t('deletion is fatal', P.verdict('a_b_c', { out: 'abc' }).level, 'fatal');
t('pure addition is only mangled', P.verdict('ab', { out: 'aXb' }).level, 'mangled');

console.log('--- chaining compounds the damage ---');
const c1 = P.chain("npm i --save 'x'", ['word']);
const c2 = P.chain("npm i --save 'x'", ['word', 'slack']);
t('one hop already breaks it via the quotes', c1.final.includes('’'), true);
t('chain records each step', c2.steps.length, 2);
t('chain feeds output forward', c2.steps[1].from, c1.final);
t('chained verdict is fatal', c2.verdict.level, 'fatal');
const clean = P.chain('hello world', ['slack', 'jira']);
t('a clean string survives a clean chain', clean.final, 'hello world');
t('and is judged safe', clean.verdict.level, 'safe');

console.log('--- structure ---');
t('every destination has a name and note',
  P.DESTINATIONS.every(d => d.name && d.note && typeof d.run === 'function'), true);
t('destination ids are unique',
  new Set(P.DESTINATIONS.map(d => d.id)).size, P.DESTINATIONS.length);
t('analyse covers every destination', P.analyse('test').length, P.DESTINATIONS.length);
t('every result carries a verdict',
  P.analyse("don't --x").every(r => ['safe', 'mangled', 'fatal'].includes(r.verdict.level)), true);
t('empty-ish input does not throw', P.analyse(' ').length, P.DESTINATIONS.length);
t('unicode input does not throw', P.analyse('café 日本語 🎉').length, P.DESTINATIONS.length);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
