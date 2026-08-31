/* Headless tests for the cron inspector engine. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = {
  document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {} }) },
  navigator: {}, console, setTimeout, URL, Intl, Date, Set, Map,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/assets/base.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/cron-inspector/app.js', 'utf8'), sandbox);
const C = sandbox.PapercutsCron;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const set = s => [...s].sort((a, b) => a - b);
const P = e => C.parseCron(e);
const throws = e => { try { C.parseCron(e); return false; } catch (x) { return true; } };
/* next fire wall-clock strings from a fixed instant */
const fires = (expr, tz, iso, n) =>
  C.nextFires(P(expr), tz, new Date(iso), n || 3, 1500)
    .map(f => f.skipped ? 'SKIPPED ' + C.wallStr(f.wall) : C.wallStr(f.wall));

console.log('--- field parsing ---');
t('star minute', set(P('* * * * *').min).length, 60);
t('single value', set(P('5 * * * *').min), [5]);
t('list', set(P('0,15,30,45 * * * *').min), [0, 15, 30, 45]);
t('range', set(P('1-5 * * * *').min), [1, 2, 3, 4, 5]);
t('step from star', set(P('*/15 * * * *').min), [0, 15, 30, 45]);
t('step in range', set(P('0-30/10 * * * *').min), [0, 10, 20, 30]);
t('open step', set(P('5/20 * * * *').min), [5, 25, 45]);
t('month names', set(P('0 0 1 JAN,JUL *').mon), [1, 7]);
t('dow names', set(P('0 0 * * MON-FRI').dow), [1, 2, 3, 4, 5]);
t('dow 7 is sunday', set(P('0 0 * * 7').dow), [0]);
t('dow 0 is sunday', set(P('0 0 * * 0').dow), [0]);
t('question mark is star', P('0 0 ? * *').domR, false);

console.log('--- macros ---');
t('@daily', [set(P('@daily').min), set(P('@daily').hour)], [[0], [0]]);
t('@hourly', [set(P('@hourly').min), set(P('@hourly').hour).length], [[0], 24]);
t('@weekly dow', set(P('@weekly').dow), [0]);
t('@monthly dom', set(P('@monthly').dom), [1]);
t('@reboot flagged', P('@reboot').reboot, true);

console.log('--- restricted flags (the OR trap) ---');
t('both star not restricted', [P('0 0 * * *').domR, P('0 0 * * *').dowR], [false, false]);
t('dom only', [P('0 0 1 * *').domR, P('0 0 1 * *').dowR], [true, false]);
t('dow only', [P('0 0 * * MON').domR, P('0 0 * * MON').dowR], [false, true]);
t('both restricted', [P('0 0 1 * MON').domR, P('0 0 1 * MON').dowR], [true, true]);
t('step star is unrestricted', P('0 0 */2 * *').domR, false);

console.log('--- invalid expressions rejected ---');
t('too few fields', throws('* * *'), true);
t('minute 60', throws('60 * * * *'), true);
t('hour 24', throws('0 24 * * *'), true);
t('dom 32', throws('0 0 32 * *'), true);
t('month 13', throws('0 0 1 13 *'), true);
t('dow 8', throws('0 0 * * 8'), true);
t('garbage', throws('banana * * * *'), true);
t('backwards range', throws('5-1 * * * *'), true);
t('valid 5 field ok', throws('0 3 * * *'), false);
t('6 field accepted as quartz', P('0 0 3 * * *').seconds, true);

console.log('--- day matching (POSIX OR semantics) ---');
/* 2026-01-01 is a Thursday; 2026-01-05 is a Monday */
t('dom only matches 1st', C.dayMatches(P('0 0 1 * *'), 2026, 1, 1), true);
t('dom only skips 5th', C.dayMatches(P('0 0 1 * *'), 2026, 1, 5), false);
t('dow only matches Monday', C.dayMatches(P('0 0 * * MON'), 2026, 1, 5), true);
t('OR trap matches the 1st (not a Monday)', C.dayMatches(P('0 0 1 * MON'), 2026, 1, 1), true);
t('OR trap also matches every Monday', C.dayMatches(P('0 0 1 * MON'), 2026, 1, 5), true);
t('month filter excludes', C.dayMatches(P('0 0 * 7 *'), 2026, 1, 1), false);

console.log('--- next fire times (UTC, no DST) ---');
t('daily 3am', fires('0 3 * * *', 'UTC', '2026-03-10T00:00:00Z', 2),
  ['2026-03-10 03:00', '2026-03-11 03:00']);
t('every 15 min', fires('*/15 * * * *', 'UTC', '2026-03-10T10:02:00Z', 3),
  ['2026-03-10 10:15', '2026-03-10 10:30', '2026-03-10 10:45']);
t('rolls to next day', fires('0 3 * * *', 'UTC', '2026-03-10T05:00:00Z', 1), ['2026-03-11 03:00']);
t('weekly monday', fires('0 9 * * MON', 'UTC', '2026-01-01T00:00:00Z', 2),
  ['2026-01-05 09:00', '2026-01-12 09:00']);
t('feb 29 leap year only', fires('0 0 29 2 *', 'UTC', '2026-01-01T00:00:00Z', 1), ['2028-02-29 00:00']);
t('never fires returns empty', fires('0 0 30 2 *', 'UTC', '2026-01-01T00:00:00Z', 1), []);

console.log('--- timezone correctness ---');
t('3am in Kolkata is a real instant',
  C.wallToUTC(2026, 3, 10, 3, 0, 'Asia/Kolkata').toISOString(), '2026-03-09T21:30:00.000Z');
t('New York offset in winter', C.offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York'), -300);
t('New York offset in summer', C.offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York'), -240);
t('UTC offset is zero', C.offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'UTC'), 0);

console.log('--- DST: spring forward ---');
/* US DST 2026 starts Sunday 8 March, 02:00 -> 03:00 local */
const spring = C.transitions('America/New_York', new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'));
t('two US transitions in 2026', spring.length, 2);
t('spring forward is +60', spring[0].delta, 60);
t('fall back is -60', spring[1].delta, -60);
t('0230 does not exist on transition day',
  C.wallToUTC(2026, 3, 8, 2, 30, 'America/New_York'), null);
t('0130 does exist',
  C.wallToUTC(2026, 3, 8, 1, 30, 'America/New_York') !== null, true);
t('0330 does exist',
  C.wallToUTC(2026, 3, 8, 3, 30, 'America/New_York') !== null, true);
t('a 2:30am job is reported skipped that day',
  fires('30 2 * * *', 'America/New_York', '2026-03-07T12:00:00Z', 2)[0], 'SKIPPED 2026-03-08 02:30');

console.log('--- DST: no false positives in a zone without DST ---');
t('Kolkata has no transitions',
  C.transitions('Asia/Kolkata', new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z')).length, 0);
t('UTC has no transitions',
  C.transitions('UTC', new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z')).length, 0);
t('2:30am job never skipped in Kolkata',
  fires('30 2 * * *', 'Asia/Kolkata', '2026-03-07T12:00:00Z', 5).some(s => s.startsWith('SKIPPED')), false);

console.log('--- collisions ---');
const mk = e => ({ cron: P(e) });
const now = new Date('2026-06-01T00:00:00Z');
const jobsA = [mk('0 3 * * *'), mk('0 3 * * *'), mk('0 4 * * *')];
const colA = C.collisionsOf(jobsA, 'UTC', now, 2);
t('collision detected', colA.length > 0, true);
t('collision has two jobs', colA[0].jobs.length, 2);
t('collision at 03:00', colA[0].when.endsWith('03:00'), true);
const jobsB = [mk('0 3 * * *'), mk('5 3 * * *')];
t('staggered jobs do not collide', C.collisionsOf(jobsB, 'UTC', now, 2).length, 0);
const jobsC = [mk('*/30 * * * *'), mk('0 * * * *')];
t('overlapping steps collide', C.collisionsOf(jobsC, 'UTC', now, 1).length > 0, true);

console.log('--- descriptions ---');
t('daily 3am', C.describe(P('0 3 * * *')), 'At 03:00, every day.');
t('every 5 min', C.describe(P('*/5 * * * *')), 'Every 5 minutes, every day.');
t('every minute', C.describe(P('* * * * *')), 'Every minute, every day.');
t('reboot', C.describe(P('@reboot')), 'Once, at system boot.');
t('OR trap description mentions OR', C.describe(P('0 0 1 * MON')).includes(' OR '), true);

console.log('--- performance ---');
const t0 = Date.now();
C.firesInWindow([mk('* * * * *'), mk('*/5 * * * *'), mk('0 3 * * *')], 'America/New_York', now, 7);
const ms = Date.now() - t0;
t('7-day scan of an every-minute job under 4s', ms < 4000, true);
console.log('    (took ' + ms + 'ms)');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
