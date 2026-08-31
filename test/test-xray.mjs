/* Headless tests for the Invisible Character X-Ray engine. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = {
  document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {} }) },
  navigator: {}, TextDecoder, Uint8Array, console, setTimeout, URL,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/assets/base.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/invisible-characters/app.js', 'utf8'), sandbox);
const { scan, clean, repairMojibake } = sandbox.PapercutsXray;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const kinds = s => Object.values(scan(s).kinds).map(k => k.short).sort();
const n = s => scan(s).found.length;

console.log('--- detection ---');
t('zero width space', kinds('a​b'), ['ZWSP']);
t('nbsp', kinds('a b'), ['NBSP']);
t('soft hyphen', kinds('a­b'), ['SHY']);
t('bom mid text', kinds('a﻿b'), ['BOM']);
t('rlo bidi', kinds('a‮b'), ['RLO']);
t('control char', kinds('ab'), ['CTRL']);
t('smart quote', kinds('it’s'), ['RQUO']);
t('em dash', kinds('a—b'), ['MDASH']);
t('ideographic space', kinds('a　b'), ['IDSP']);
t('homoglyph cyrillic A', kinds('Аdmin'), ['HOMO']);
t('replacement char', kinds('a�b'), ['REPL']);
t('en quad space', kinds('a b'), ['SP']);
t('counts repeats', n('​​​a'), 3);

console.log('--- must NOT fire ---');
t('plain ascii', n('Hello, world! 123'), 0);
t('newlines and tabs', n('a\n\tb\r\n'), 0);
t('normal accents', n('café naïve Müller'), 0);
t('emoji', n('hello 👋 there'), 0);
t('cjk text', n('日本語のテキスト'), 0);
t('genuine russian is not homoglyph-flagged', n('Привет, как дела? Это обычный русский текст.'), 0);
t('genuine greek is not homoglyph-flagged', n('Καλημέρα κόσμε, αυτό είναι ελληνικό κείμενο.'), 0);

console.log('--- mojibake ---');
t('repairs e-acute', repairMojibake('CafÃ©'), 'Café');
t('repairs u-umlaut', repairMojibake('MÃ¼ller'), 'Müller');
t('repairs smart apostrophe', repairMojibake('itâ€™s'), 'it’s');
t('leaves clean text alone', repairMojibake('Hello world'), 'Hello world');
t('leaves genuine accents alone', repairMojibake('café'), 'café');
t('leaves genuine russian alone', repairMojibake('Привет'), 'Привет');
t('flag set on mojibake', scan('CafÃ©').mojibake, true);
t('flag clear on clean text', scan('Cafe').mojibake, false);
t('flag clear on real accents', scan('café').mojibake, false);
t('mixed: repairs only the broken run', repairMojibake('ok CafÃ© ok'), 'ok Café ok');

console.log('--- cleaning ---');
t('removes invisible', clean('a​­b', { invisible: true }), 'ab');
t('normalises spaces', clean('a 　b', { spaces: true }), 'a  b');
t('straightens punctuation', clean('‘x’ “y” – …', { punct: true }), "'x' \"y\" - ...");
t('maps homoglyphs', clean('Аdmin', { homo: true }), 'Admin');
t('tidy collapses spaces', clean('a   b   \nc  ', { tidy: true }), 'a b\nc');
t('nfc normalises', clean('é', { nfc: true }), 'é');
t('no options is identity', clean('a​b', {}), 'a​b');
t('does not eat newlines', clean('a\nb', { invisible: true, spaces: true, tidy: true }), 'a\nb');
t('does not eat emoji zwj by default', clean('👩‍💻', {}), '👩‍💻');

console.log('--- sample sanity ---');
const S = sandbox.PapercutsXray;
t('scan of empty string', n(''), 0);
t('cleaning is idempotent', clean(clean('a​ b', { invisible: true, spaces: true }), { invisible: true, spaces: true }), 'a b');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
