/* Headless tests for the nested JSON to CSV engine. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = {
  document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {} }) },
  navigator: {}, console, setTimeout, URL, JSON, Blob: class { constructor(a){ this.size = 0; } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/assets/base.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/json-to-csv/app.js', 'utf8'), sandbox);
const { parseInput, findArrays, flatten, toCSV } = sandbox.PapercutsJSON;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}

console.log('--- parsing ---');
t('plain array', parseInput('[{"a":1}]').data, [{ a: 1 }]);
t('object', parseInput('{"a":1}').data, { a: 1 });
t('ndjson', parseInput('{"a":1}\n{"a":2}').data, [{ a: 1 }, { a: 2 }]);
t('ndjson flag', parseInput('{"a":1}\n{"a":2}').ndjson, true);
t('whitespace tolerated', parseInput('  {"a":1}  ').data, { a: 1 });
try { parseInput(''); t('empty throws', false, true); } catch (e) { t('empty throws', true, true); }
try { parseInput('{oops'); t('bad json throws', false, true); } catch (e) { t('bad json throws', true, true); }

console.log('--- array discovery ---');
const nested = { meta: { v: 1 }, orders: [{ id: 1 }, { id: 2 }, { id: 3 }] };
t('finds nested array', findArrays(nested)[0].path, 'orders');
t('finds nested array len', findArrays(nested)[0].arr.length, 3);
t('top level array', findArrays([{ a: 1 }])[0].path, '(top level)');
t('single record fallback', findArrays({ a: 1 })[0].path, '(single record)');
t('biggest array first', findArrays({ small: [{ x: 1 }], big: [{ x: 1 }, { x: 2 }] })[0].path, 'big');

console.log('--- flatten: nested objects ---');
const rec = [{ id: 1, customer: { name: 'Ada', addr: { city: 'London' } } }];
t('dot notation cols', flatten(rec, 'join').cols, ['id', 'customer.name', 'customer.addr.city']);
t('dot notation row', flatten(rec, 'join').rows[0], { id: 1, 'customer.name': 'Ada', 'customer.addr.city': 'London' });

console.log('--- flatten: array modes ---');
const withArr = [{ id: 1, tags: ['a', 'b'] }];
t('join mode single row', flatten(withArr, 'join').rows.length, 1);
t('join mode value', flatten(withArr, 'join').rows[0].tags, 'a; b');
t('index mode cols', flatten(withArr, 'index').cols, ['id', 'tags.0', 'tags.1']);
t('index mode single row', flatten(withArr, 'index').rows.length, 1);
t('explode mode two rows', flatten(withArr, 'explode').rows.length, 2);
t('explode repeats parent', flatten(withArr, 'explode').rows.map(r => r.id), [1, 1]);
t('explode values', flatten(withArr, 'explode').rows.map(r => r.tags), ['a', 'b']);

console.log('--- flatten: arrays of objects ---');
const orders = [{ id: 1, items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }] }];
const ex = flatten(orders, 'explode');
t('explode objects rows', ex.rows.length, 2);
t('explode objects cols', ex.cols, ['id', 'items.sku', 'items.qty']);
t('explode objects values', ex.rows.map(r => r['items.sku']), ['A', 'B']);

console.log('--- flatten: edge cases ---');
t('empty array becomes blank', flatten([{ a: [] }], 'explode').rows[0].a, '');
t('null becomes blank', flatten([{ a: null }], 'join').rows[0].a, '');
t('boolean stringified', flatten([{ a: true }], 'join').rows[0].a, 'true');
t('zero preserved', flatten([{ a: 0 }], 'join').rows[0].a, 0);
t('empty object blank', flatten([{ a: {} }], 'join').rows[0].a, '');
t('scalar record named value', flatten(['x', 'y'], 'join').cols, ['value']);
t('scalar record rows', flatten(['x', 'y'], 'join').rows.map(r => r.value), ['x', 'y']);
t('ragged records union of cols', flatten([{ a: 1 }, { b: 2 }], 'join').cols, ['a', 'b']);
t('deep nesting', flatten([{ a: { b: { c: { d: 1 } } } }], 'join').cols, ['a.b.c.d']);

console.log('--- csv output ---');
const csv = toCSV([{ a: 'x', b: 'y' }], ['a', 'b']);
t('has BOM', csv.charCodeAt(0), 0xFEFF);
t('header row', csv.slice(1).split('\r\n')[0], '"a","b"');
t('data row', csv.slice(1).split('\r\n')[1], '"x","y"');
t('escapes quotes', toCSV([{ a: 'he said "hi"' }], ['a']).includes('"he said ""hi"""'), true);
t('embedded comma safe', toCSV([{ a: 'x,y' }], ['a']).includes('"x,y"'), true);
t('missing key blank', toCSV([{ a: 1 }], ['a', 'b']).includes('"1",""'), true);
t('newline in value quoted', toCSV([{ a: 'x\ny' }], ['a']).includes('"x\ny"'), true);

console.log('--- realistic end to end ---');
const real = parseInput(JSON.stringify({
  orders: [
    { id: 1042, customer: { name: 'Ada', address: { city: 'London' } }, tags: ['priority', 'gift'],
      items: [{ sku: 'KB-01', qty: 1 }, { sku: 'MS-04', qty: 2 }] }
  ]
}));
const src = findArrays(real.data)[0];
const out = flatten(src.arr, 'explode');
t('cartesian of tags x items', out.rows.length, 4);
t('all parent fields present', out.rows[0].id, 1042);
t('nested address flattened', out.rows[0]['customer.address.city'], 'London');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
