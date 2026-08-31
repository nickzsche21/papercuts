/* Headless tests for the filename checker. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = {
  document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {} }) },
  navigator: {}, TextEncoder, console, setTimeout, URL, Set, Map,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/assets/base.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/filename-checker/app.js', 'utf8'), sandbox);
const { checkName, safeName, findCollisions, byteLen } = sandbox.PapercutsNames;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
/* does any issue for platform p reach severity `sev`? */
const has = (n, p, sev) => checkName(n).some(i => i.plat.includes(p) && (!sev || i.sev === sev));
const nIssues = n => checkName(n).length;

console.log('--- reserved names ---');
t('con.txt fails on windows', has('con.txt', 'win', 'bad'), true);
t('CON fails on windows', has('CON', 'win', 'bad'), true);
t('com1.log fails', has('com1.log', 'win', 'bad'), true);
t('lpt9 fails', has('LPT9', 'win', 'bad'), true);
t('console.txt is fine', has('console.txt', 'win', 'bad'), false);
t('contract.pdf is fine', has('contract.pdf', 'win', 'bad'), false);

console.log('--- illegal characters ---');
t('colon fails windows', has('invoice: march.pdf', 'win', 'bad'), true);
t('colon warns mac', has('invoice: march.pdf', 'mac', 'warn'), true);
t('angle brackets fail', has('budget<draft>.xlsx', 'win', 'bad'), true);
t('pipe fails', has('a|b.txt', 'win', 'bad'), true);
t('question mark fails', has('what?.txt', 'win', 'bad'), true);
t('hash fails sharepoint', has('a#b.txt', 'sp', 'bad'), true);
t('percent fails sharepoint', has('50%.txt', 'sp', 'bad'), true);
t('hash is fine on windows', has('a#b.txt', 'win', 'bad'), false);

console.log('--- trailing and leading ---');
t('trailing space fails', has('notes ', 'win', 'bad'), true);
t('trailing dot fails', has('report.', 'win', 'bad'), true);
t('leading dash warns', has('-rf.sh', 'nix', 'warn'), true);
t('leading space warns sharepoint', has(' notes.txt', 'sp', 'warn'), true);
t('leading dot warns hidden', has('.env', 'nix', 'warn'), true);

console.log('--- length ---');
t('255 byte name fails linux', has('a'.repeat(256) + '.txt', 'nix', 'bad'), true);
t('emoji costs 4 bytes', byteLen('📸'), 4);
t('accent costs 2 bytes', byteLen('ü'), 2);
t('normal name ok', has('report.pdf', 'nix', 'bad'), false);

console.log('--- statefulness regression (the /g .test bug) ---');
t('control char detected 1st call', has('ab.txt', 'nix', 'bad'), true);
t('control char detected 2nd call', has('ab.txt', 'nix', 'bad'), true);
t('control char detected 3rd call', has('ab.txt', 'nix', 'bad'), true);
t('clean name stays clean 1', has('clean.txt', 'nix', 'bad'), false);
t('clean name stays clean 2', has('clean.txt', 'nix', 'bad'), false);

console.log('--- clean names produce no issues ---');
t('report.pdf clean', nIssues('report.pdf'), 0);
t('my-file_2026.csv clean', nIssues('my-file_2026.csv'), 0);
t('README.md clean', nIssues('README.md'), 0);

console.log('--- safe rewrites ---');
t('colon replaced', safeName('invoice: march.pdf'), 'invoice- march.pdf');
t('reserved suffixed', safeName('con.txt'), 'con-file.txt');
t('trailing space trimmed', safeName('notes '), 'notes');
t('trailing dot trimmed', safeName('report.'), 'report');
t('leading dash removed', safeName('-rf.sh'), 'rf.sh');
t('angle brackets replaced', safeName('budget<draft>.xlsx'), 'budget-draft-.xlsx');
t('clean name unchanged', safeName('report.pdf'), 'report.pdf');
t('empty becomes untitled', safeName('...'), 'untitled');
t('long name keeps extension', safeName('x'.repeat(300) + '.docx').endsWith('.docx'), true);
t('long name is under limit', byteLen(safeName('x'.repeat(300) + '.docx')) <= 200, true);
t('safe name has no hard failures', checkName(safeName('invoice: march<>.pdf ')).some(i => i.sev === 'bad'), false);
t('safe name of cursed set never fails', ['con.txt','a|b<>.txt','notes ','-rf.sh','report..pdf'].every(n => !checkName(safeName(n)).some(i => i.sev === 'bad')), true);
t('rewrite is idempotent', safeName(safeName('con.txt')), safeName('con.txt'));

console.log('--- collisions ---');
const caseCol = findCollisions(['README.md', 'readme.md']);
t('case collision found', caseCol.length, 1);
t('case collision kind', caseCol[0].kind, 'case');
t('no collision for distinct names', findCollisions(['a.txt', 'b.txt']).length, 0);
t('no collision for exact duplicates', findCollisions(['a.txt', 'a.txt']).length, 0);
const trailCol = findCollisions(['notes', 'notes ']);
t('trailing collision found', trailCol.some(c => c.kind === 'trailing'), true);
const uniCol = findCollisions(['café.txt', 'café.txt']);
t('unicode collision found', uniCol.some(c => c.kind === 'unicode'), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
