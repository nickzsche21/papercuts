/* Headless test harness for the CSV guard rule engine. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = {
  document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {} }) },
  navigator: {}, Blob: class { constructor(a){ this.size = Buffer.byteLength(a.join('')); } },
  setTimeout, console, URL,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/assets/base.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/csv-excel-guard/app.js', 'utf8'), sandbox);

const { analyzeCell, parseCSV, detectDelimiter, serialize } = sandbox.PapercutsCSV;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const rule = v => { const r = analyzeCell(v); return r ? r.id : null; };
const shows = v => { const r = analyzeCell(v); return r ? r.becomes : null; };

console.log('--- rule classification ---');
t('gene SEPT1', rule('SEPT1'), 'date-word');
t('gene MARCH1', rule('MARCH1'), 'date-word');
t('gene DEC1', rule('DEC1'), 'date-word');
t('gene OCT4', rule('OCT4'), 'date-word');
t('1-Sep', rule('1-Sep'), 'date-word');
t('fraction 3/4', rule('3/4'), 'date-short');
t('1-2', rule('1-2'), 'date-short');
t('leading zero 02134', rule('02134'), 'leading-zero');
t('leading zero 00501', rule('00501'), 'leading-zero');
t('barcode 13 digits', rule('4006381333931'), 'scientific');
t('19-digit id', rule('1234567890123456789'), 'precision');
t('exponent 2E10', rule('2E10'), 'exponent');
t('formula =1+1', rule('=1+1'), 'formula');
t('formula @SUM', rule('@SUM(A1:A9)'), 'formula');
t('intl phone +44', rule('+44 20 7946 0958'), 'formula');
t('neg lookup -lookup', rule('-lookup'), 'formula');
t('ambiguous date', rule('03/04/2026'), 'date-ambiguous');
t('unambiguous date 15/06/2026', rule('15/06/2026'), 'date-ambiguous');
t('time 1:30', rule('1:30'), 'time');
t('thousands 1,234', rule('1,234'), 'thousands');
t('error #N/A', rule('#N/A'), 'error-literal');
t('boolean TRUE', rule('TRUE'), 'boolean');
t('zero width', rule('Acme​ Corp'), 'invisible');
t('nbsp', rule('Acme Corp'), 'invisible');
t('trailing space', rule('Acme '), 'whitespace');

console.log('--- must NOT fire (false positives) ---');
t('plain int', rule('42'), null);
t('plain decimal', rule('3.14'), null);
t('negative number', rule('-5'), null);
t('negative decimal', rule('-12.75'), null);
t('word', rule('Acme'), null);
t('email', rule('a@b.com'), null);
t('sentence', rule('Hello world'), null);
t('ISO date', rule('2026-08-31'), null);
t('uuid', rule('550e8400-e29b-41d4-a716-446655440000'), null);
t('11 digit number', rule('12345678901'), null);
t('zero alone', rule('0'), null);
t('url', rule('https://example.com/a?b=1'), null);
t('currency text', rule('USD 500'), null);
t('MAY alone (no digit)', rule('MAY'), null);
t('MARCHING1 not a month', rule('MARCHING1'), null);
t('13/13 not a date', rule('13/13'), null);

console.log('--- rendered "Excel shows" values ---');
t('SEPT1 becomes', shows('SEPT1'), '1-Sep');
t('MARCH1 becomes', shows('MARCH1'), '1-Mar');
t('3/4 becomes', shows('3/4'), '4-Mar');
t('02134 becomes', shows('02134'), '2134');
t('19-digit becomes', shows('1234567890123456789'), '1234567890123450000');
t('2E10 becomes', shows('2E10'), '20000000000');
t('13-digit becomes', shows('4006381333931'), '4.00638E+12');

console.log('--- parser ---');
t('simple parse', parseCSV('a,b\n1,2\n', ','), [['a','b'],['1','2']]);
t('quoted comma', parseCSV('a,b\n"x,y",2\n', ','), [['a','b'],['x,y','2']]);
t('escaped quote', parseCSV('a\n"he said ""hi"""\n', ','), [['a'],['he said "hi"']]);
t('embedded newline', parseCSV('a,b\n"line1\nline2",2\n', ','), [['a','b'],['line1\nline2','2']]);
t('crlf', parseCSV('a,b\r\n1,2\r\n', ','), [['a','b'],['1','2']]);
t('ragged', parseCSV('a,b,c\n1,2\n', ','), [['a','b','c'],['1','2']]);
t('empty trailing field', parseCSV('a,b\n1,\n', ','), [['a','b'],['1','']]);
t('delim semicolon', detectDelimiter('a;b;c\n1;2;3\n'), ';');
t('delim tab', detectDelimiter('a\tb\tc\n1\t2\t3\n'), '\t');
t('delim comma default', detectDelimiter('a,b,c\n1,2,3\n'), ',');
t('delim pipe', detectDelimiter('a|b|c\n1|2|3\n'), '|');

console.log('--- serialize ---');
const rows = parseCSV('id,gene\n0001,SEPT1\n', ',');
const xl = serialize(rows, ',', 'excel');
t('excel mode has BOM', xl.charCodeAt(0), 0xFEFF);
t('excel wraps flagged', xl.includes('="SEPT1"'), true);
t('excel wraps leading zero', xl.includes('="0001"'), true);
t('excel leaves header alone', xl.includes('"id","gene"'), true);
const cl = serialize(parseCSV('a\n=cmd|calc\n', ','), ',', 'clean');
t('clean defuses formula', cl.includes('"\'=cmd|calc"'), true);
const cl2 = serialize(parseCSV('a\n"  x​y  "\n', ','), ',', 'clean');
t('clean strips invisible+trims', cl2.includes('"xy"'), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
