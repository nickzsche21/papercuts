/* Headless tests for the CSV diff-by-key engine. */
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
vm.runInContext(fs.readFileSync(ROOT + '/csv-diff/app.js', 'utf8'), sandbox);
const D = sandbox.PapercutsCsvDiff;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const T = s => D.toTable(s);
const run = (a, b, k) => { const ta = T(a), tb = T(b); return D.diff(ta, tb, k || [D.guessKey(ta, tb)]); };

const A = 'id,name,price\n1,Widget,10\n2,Gadget,20\n3,Doohickey,30\n';

console.log('--- parsing ---');
t('header parsed', T(A).header, ['id', 'name', 'price']);
t('rows parsed', T(A).rows.length, 3);
t('quoted comma', T('id,name\n1,"a,b"\n').rows[0][1], 'a,b');
t('escaped quote', T('id,n\n1,"say ""hi"""\n').rows[0][1], 'say "hi"');
t('semicolon delimiter', T('id;name\n1;x\n').header, ['id', 'name']);
t('tab delimiter', T('id\tname\n1\tx\n').header, ['id', 'name']);
t('BOM stripped', T('﻿id,name\n1,x\n').header, ['id', 'name']);
t('trailing blank line ignored', T('id,name\n1,x\n\n').rows.length, 1);
t('crlf handled', T('id,name\r\n1,x\r\n').rows.length, 1);

console.log('--- key guessing ---');
t('unique column detected', D.uniqueIn(T(A), 0), true);
t('non-unique column rejected', D.uniqueIn(T('id,g\n1,x\n2,x\n'), 1), false);
t('empty value disqualifies', D.uniqueIn(T('id,g\n1,x\n2,\n'), 1), false);
t('guesses the id column', D.guessKey(T(A), T(A)), 'id');
t('prefers a key-ish name',
  D.guessKey(T('name,sku\na,1\nb,2\n'), T('name,sku\na,1\nb,2\n')), 'sku');
t('falls back when nothing is unique',
  D.guessKey(T('a,b\n1,1\n1,1\n'), T('a,b\n1,1\n1,1\n')), null);

console.log('--- the whole point: row order is not a change ---');
const reordered = 'id,name,price\n3,Doohickey,30\n1,Widget,10\n2,Gadget,20\n';
const rd = run(A, reordered);
t('reordering produces no changes', rd.changed.length, 0);
t('reordering produces no additions', rd.added.length, 0);
t('reordering produces no removals', rd.removed.length, 0);
t('everything counts as unchanged', rd.unchanged, 3);

console.log('--- added / removed / changed ---');
const B = 'id,name,price\n1,Widget,10\n2,Gadget,25\n4,Whatsit,40\n';
const d = run(A, B);
t('one changed row', d.changed.length, 1);
t('changed key is 2', d.changed[0].key, '2');
t('changed column is price', d.changed[0].cells[0].col, 'price');
t('before value', d.changed[0].cells[0].from, '20');
t('after value', d.changed[0].cells[0].to, '25');
t('one added row', d.added.map(r => r.key), ['4']);
t('one removed row', d.removed.map(r => r.key), ['3']);
t('one unchanged row', d.unchanged, 1);

console.log('--- column changes ---');
const withCol = 'id,name,price,supplier\n1,Widget,10,Acme\n2,Gadget,20,Acme\n3,Doohickey,30,Acme\n';
const cd = run(A, withCol);
t('added column detected', cd.addedCols, ['supplier']);
t('a new column does not mark rows changed', cd.changed.length, 0);
t('all rows still unchanged', cd.unchanged, 3);
const lessCol = 'id,name\n1,Widget\n2,Gadget\n3,Doohickey\n';
t('removed column detected', run(A, lessCol).removedCols, ['price']);
t('removed column does not mark rows changed', run(A, lessCol).changed.length, 0);

console.log('--- duplicate keys are reported, not guessed at ---');
const dup = 'id,name,price\n1,Widget,10\n1,Widget,11\n2,Gadget,20\n';
const dd = D.diff(T(dup), T(dup), ['id']);
t('duplicate key detected', dd.dupes, ['1']);
t('clean data reports no duplicates', run(A, B).dupes.length, 0);

console.log('--- composite keys ---');
const ca = 'region,sku,qty\nEU,A1,5\nUS,A1,7\n';
const cb = 'region,sku,qty\nEU,A1,6\nUS,A1,7\n';
const cc = D.diff(T(ca), T(cb), ['region', 'sku']);
t('composite key pairs correctly', cc.changed.length, 1);
const NUL = String.fromCharCode(0);
t('composite key names the row', cc.changed[0].key, 'EU' + NUL + 'A1');
/* A space separator would make these two collide; NUL cannot appear in a cell. */
const collideA = 'a,b,v\nNew,York,1\nNew York,,2\n';
t('composite key does not collide with a spaced value',
  D.diff(T(collideA), T(collideA), ['a', 'b']).dupes.length, 0);
t('composite key has no duplicates', cc.dupes.length, 0);
t('single non-unique key would be ambiguous', D.diff(T(ca), T(cb), ['sku']).dupes, ['A1']);

console.log('--- edge cases ---');
t('identical files show nothing', run(A, A).changed.length + run(A, A).added.length + run(A, A).removed.length, 0);
t('empty value change is detected',
  run('id,n\n1,x\n', 'id,n\n1,\n').changed[0].cells[0].to, '');
t('whitespace difference is a change',
  run('id,n\n1,x\n', 'id,n\n1,x \n').changed.length, 1);
t('numeric string compared as text',
  run('id,n\n1,1.0\n', 'id,n\n1,1\n').changed.length, 1);
t('all rows removed', run(A, 'id,name,price\n').removed.length, 3);
t('all rows added', run('id,name,price\n', A).added.length, 3);

console.log('--- diff export ---');
const csv = D.diffCSV(d, T(A), T(B));
t('export has BOM', csv.charCodeAt(0), 0xFEFF);
t('export header', csv.slice(1).split('\r\n')[0], '"change","id","column","before","after"');
t('export includes the change', csv.includes('"changed","2","price","20","25"'), true);
t('export includes the addition', csv.includes('"added","4"'), true);
t('export includes the removal', csv.includes('"removed","3"'), true);
t('export escapes quotes',
  D.diffCSV(run('id,n\n1,a\n', 'id,n\n1,"say ""hi"""\n'), T('id,n\n1,a\n'), T('id,n\n1,x\n'))
    .includes('""hi""'), true);

console.log('--- realistic sample from the page ---');
const SA = 'sku,name,price,stock\nA-100,Widget,9.99,42\nA-101,Gadget,24.50,7\nA-102,Doohickey,4.00,0\nA-103,Thingamajig,15.75,3\n';
const SB = 'sku,name,price,stock,supplier\nA-103,Thingamajig,15.75,3,Acme\nA-101,Gadget,27.00,7,Acme\nA-100,Widget,9.99,40,Globex\nA-104,Whatsit,6.25,12,Globex\n';
const sd = run(SA, SB);
t('sample key is sku', sd.keyCols, ['sku']);
t('sample: two rows changed', sd.changed.length, 2);
t('sample: one added', sd.added.map(r => r.key), ['A-104']);
t('sample: one removed', sd.removed.map(r => r.key), ['A-102']);
t('sample: one untouched despite moving', sd.unchanged, 1);
t('sample: supplier reported as a new column', sd.addedCols, ['supplier']);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
