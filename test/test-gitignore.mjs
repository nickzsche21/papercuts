/* Headless tests for the .gitignore debugger.
   Part 2 is a differential test against real `git check-ignore`. */
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
vm.runInContext(fs.readFileSync(ROOT + '/gitignore/app.js', 'utf8'), sandbox);
const G = sandbox.PapercutsGitignore;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const ign = (rules, p) => { const d = G.decide(p, G.parseIgnore(rules)); return d ? d.ignored : null; };

console.log('--- line parsing ---');
t('comment skipped', G.parseLine('# hi', 1), null);
t('blank skipped', G.parseLine('   ', 1), null);
t('negation detected', G.parseLine('!keep.txt', 1).negate, true);
t('dir-only detected', G.parseLine('build/', 1).dirOnly, true);
t('anchored by leading slash', G.parseLine('/dist', 1).anchored, true);
t('anchored by middle slash', G.parseLine('doc/build', 1).anchored, true);
t('unanchored bare name', G.parseLine('build', 1).anchored, false);
t('dir-only is not anchored by its trailing slash', G.parseLine('build/', 1).anchored, false);
t('escaped bang is literal', G.parseLine('\\!x', 1).negate, false);
t('trailing spaces stripped', G.parseLine('foo   ', 1).pattern, 'foo');
t('line number recorded', G.parseLine('x', 7).line, 7);

console.log('--- glob translation ---');
t('star does not cross slash', G.globToRe('*'), '[^/]*');
t('question mark', G.globToRe('?'), '[^/]');
t('dot escaped', G.globToRe('a.b'), 'a\\.b');
t('leading globstar', G.globToRe('**/foo'), '(?:.*/)?foo');
t('trailing globstar', G.globToRe('foo/**'), 'foo/.*');
t('middle globstar', G.globToRe('a/**/b'), 'a/(?:.*/)?b');
t('char class', G.globToRe('[abc]'), '[abc]');
t('negated char class', G.globToRe('[!a]'), '[^a]');

console.log('--- matching basics ---');
t('exact file', ign('foo.txt', 'foo.txt'), true);
t('non-match', ign('foo.txt', 'bar.txt'), false);
t('extension glob', ign('*.log', 'app.log'), true);
t('glob at depth', ign('*.log', 'src/deep/app.log'), true);
t('glob does not cross slash', ign('src/*.log', 'src/deep/app.log'), false);
t('bare name matches at any depth', ign('build', 'a/b/build'), true);
t('anchored does not match at depth', ign('/build', 'a/b/build'), false);
t('anchored matches at root', ign('/build', 'build'), true);
t('middle slash is anchored', ign('doc/build', 'doc/build'), true);
t('middle slash not matched deeper', ign('doc/build', 'src/doc/build'), false);
t('dir contents ignored', ign('node_modules/', 'node_modules/react/index.js'), true);
t('dir-only does not match a file', ign('build/', 'build'), false);
t('globstar depth', ign('**/logs', 'a/b/logs'), true);
t('char class matches', ign('file[0-9].txt', 'file3.txt'), true);
t('char class rejects', ign('file[0-9].txt', 'fileA.txt'), false);

console.log('--- precedence: last match wins ---');
t('negation after wins', ign('*.log\n!keep.log', 'keep.log'), false);
t('re-ignore after negation wins', ign('*.log\n!keep.log\n*.log', 'keep.log'), true);
t('order matters the other way', ign('!keep.log\n*.log', 'keep.log'), true);

console.log('--- the re-include trap ---');
const trapped = G.decide('build/keep.txt', G.parseIgnore('build/\n!build/keep.txt'));
t('trapped file is still ignored', trapped.ignored, true);
t('trap is detected', !!trapped.trap, true);
t('trap names the blocking dir', trapped.blockedAt, 'build');
t('trap names the dead negation line', trapped.trap.line, 2);
t('suggested fix excludes contents', G.suggestFix(trapped), ['build/*', '!build/keep.txt']);
const notTrapped = G.decide('build/keep.txt', G.parseIgnore('build/*\n!build/keep.txt'));
t('contents form actually works', notTrapped.ignored, false);
t('and reports no trap', !!notTrapped.trap, false);

console.log('--- edge cases ---');
t('leading ./ stripped', ign('foo.txt', './foo.txt'), true);
t('trailing slash on path means dir', G.decide('build/', G.parseIgnore('build/')).ignored, true);
t('empty path returns null', G.decide('   ', G.parseIgnore('x')), null);
t('no rules means not ignored', ign('# only a comment', 'a.txt'), false);
t('invalid regex chars do not throw', ign('a[b', 'a[b'), true);
t('unicode path', ign('*.log', 'café/app.log'), true);
t('space in pattern', ign('my file.txt', 'my file.txt'), true);

/* ------------------------------------------------------------------------ */
console.log('\n--- differential test against real git check-ignore ---');

let gitOk = true;
try { execFileSync('git', ['--version'], { stdio: 'pipe' }); }
catch (e) { gitOk = false; console.log('  (git unavailable — skipping)'); }

if (gitOk) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-gitignore-'));
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });

  const RULES = [
    '# build output', 'build/', '!build/keep.txt', '',
    '*.log', '!important.log', '',
    'node_modules/', '.env*', '!.env.example',
    '/dist', 'doc/build', '**/tmp', 'file[0-9].txt',
    'a/**/z', 'src/*.cache', 'weird\\ name.txt'
  ].join('\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), RULES + '\n');

  const PATHS = [
    'build/keep.txt', 'build/bundle.js', 'build/sub/deep.js',
    'important.log', 'src/app.log', 'app.log',
    'node_modules/react/index.js', '.env.local', '.env.example', '.envrc',
    'dist/main.js', 'src/dist/main.js',
    'doc/build/index.html', 'src/doc/build/index.html',
    'tmp/x.txt', 'a/b/tmp/y.txt',
    'file3.txt', 'fileA.txt',
    'a/b/c/z', 'a/z', 'src/data.cache', 'src/sub/data.cache',
    'src/index.js', 'README.md'
  ];

  /* create the files so git treats directories realistically */
  for (const p of PATHS) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
  }

  const rules = G.parseIgnore(RULES);
  let agree = 0, disagree = 0;
  for (const p of PATHS) {
    let gitSays;
    try {
      execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: dir, stdio: 'pipe' });
      gitSays = true;
    } catch (e) { gitSays = e.status === 1 ? false : null; }
    if (gitSays === null) continue;
    const mine = G.decide(p, rules).ignored;
    if (mine === gitSays) { agree++; pass++; }
    else {
      disagree++; fail++;
      console.log('FAIL  disagrees with git on "' + p + '": git=' + gitSays + ' mine=' + mine);
    }
  }
  console.log('  ' + agree + ' paths agree with real git, ' + disagree + ' disagree');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
