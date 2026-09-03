/* Headless tests for the .dockerignore matcher.
   Docker was not available on this machine, so unlike test-gitignore.mjs there
   is no differential test against the real daemon. These assert the documented
   rules, and in particular the root-anchoring that separates .dockerignore from
   .gitignore — the behaviour the tool exists to surface. */
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
vm.runInContext(fs.readFileSync(ROOT + '/dockerignore/app.js', 'utf8'), sandbox);
const D = sandbox.PapercutsDockerignore;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL  ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const exc = (rules, p) => { const d = D.decide(p, D.parseIgnore(rules)); return d ? d.excluded : null; };

console.log('--- line parsing ---');
t('comment skipped', D.parseLine('# hi', 1), null);
t('blank skipped', D.parseLine('   ', 1), null);
t('negation detected', D.parseLine('!keep.txt', 1).negate, true);
t('leading slash stripped', D.parseLine('/dist', 1).pattern, 'dist');
t('trailing slash stripped', D.parseLine('dist/', 1).pattern, 'dist');
t('bare name flagged', D.parseLine('node_modules', 1).bareName, true);
t('path is not a bare name', D.parseLine('app/node_modules', 1).bareName, false);
t('globstar is not a bare name', D.parseLine('**/node_modules', 1).bareName, false);
t('line number recorded', D.parseLine('x', 9).line, 9);

console.log('--- matching basics ---');
t('exact file', exc('foo.txt', 'foo.txt'), true);
t('non-match', exc('foo.txt', 'bar.txt'), false);
t('star does not cross a separator', exc('*.log', 'src/app.log'), false);
t('star at root matches', exc('*.log', 'app.log'), true);
t('explicit path', exc('src/*.log', 'src/app.log'), true);
t('question mark', exc('temp?', 'tempa'), true);
t('question mark rejects two', exc('temp?', 'tempab'), false);
t('char class', exc('file[0-9].txt', 'file3.txt'), true);
t('char class rejects', exc('file[0-9].txt', 'fileA.txt'), false);
t('directory excludes its contents', exc('node_modules', 'node_modules/react/index.js'), true);
t('leading slash is equivalent', exc('/dist', 'dist/main.js'), true);

console.log('--- THE difference from .gitignore: root anchoring ---');
t('bare name matches at the root', exc('node_modules', 'node_modules/react/index.js'), true);
t('bare name does NOT match nested', exc('node_modules', 'packages/ui/node_modules/x.js'), false);
t('bare name does NOT match one level down', exc('node_modules', 'app/node_modules/x.js'), false);
t('globstar DOES match nested', exc('**/node_modules', 'packages/ui/node_modules/x.js'), true);
t('globstar still matches at the root', exc('**/node_modules', 'node_modules/react/index.js'), true);
t('explicit depth matches that depth only', exc('*/node_modules', 'app/node_modules/x.js'), true);
t('explicit depth misses deeper', exc('*/node_modules', 'a/b/node_modules/x.js'), false);

console.log('--- globstar forms ---');
t('leading globstar', exc('**/*.log', 'a/b/app.log'), true);
t('leading globstar at root', exc('**/*.log', 'app.log'), true);
t('trailing globstar', exc('dist/**', 'dist/a/b.js'), true);
t('middle globstar', exc('a/**/z.txt', 'a/b/c/z.txt'), true);
t('middle globstar with no dirs', exc('a/**/z.txt', 'a/z.txt'), true);

console.log('--- precedence: last match wins ---');
t('exception after wins', exc('*.md\n!README.md', 'README.md'), false);
t('re-exclusion after exception wins', exc('*.md\n!README.md\nREADME.md', 'README.md'), true);
t('order reversed', exc('!README.md\n*.md', 'README.md'), true);
t('exception inside an excluded directory', exc('dist\n!dist/manifest.json', 'dist/manifest.json'), false);
t('siblings stay excluded', exc('dist\n!dist/manifest.json', 'dist/bundle.js'), true);

console.log('--- normalisation ---');
t('leading ./ stripped', exc('foo.txt', './foo.txt'), true);
t('leading / stripped from a path', exc('foo.txt', '/foo.txt'), true);
t('trailing slash on a path', exc('dist', 'dist/'), true);
t('empty path returns null', D.decide('   ', D.parseIgnore('x')), null);
t('no rules means nothing excluded', exc('# only a comment', 'a.txt'), false);

console.log('--- divergence detection ---');
const rules = D.parseIgnore('node_modules\n*.log');
const paths = ['node_modules/a.js', 'packages/ui/node_modules/b.js', 'src/index.js'];
const div = D.gitDivergence(rules, paths);
t('flags the bare pattern', div.length, 1);
t('names the pattern', div[0].rule.pattern, 'node_modules');
t('lists what is still being copied', div[0].missed, ['packages/ui/node_modules/b.js']);
t('suggests the globstar fix', div[0].fix, '**/node_modules');
t('no divergence when already globstarred',
  D.gitDivergence(D.parseIgnore('**/node_modules'), paths).length, 0);
t('no divergence when nothing is nested',
  D.gitDivergence(D.parseIgnore('node_modules'), ['node_modules/a.js']).length, 0);

console.log('--- COPY diagnosis ---');
const R = D.parseIgnore('dist\n!dist/manifest.json\nnode_modules');
const P = ['dist/manifest.json', 'dist/bundle.js', 'src/index.js'];
const cp = s => D.diagnoseCopy(s, R, P);
t('parses a COPY instruction', cp('COPY ./src/index.js /app/').src, './src/index.js');
t('parses flags', cp('COPY --chown=1:1 ./src/index.js /app/').src, './src/index.js');
t('parses ADD too', cp('ADD ./src/index.js /app/').src, './src/index.js');
t('bare path works', cp('src/index.js').src, 'src/index.js');
t('flags a parent-escaping path',
  cp('COPY ../shared/x.json /app/').issues.some(i => /outside the build context/.test(i.title)), true);
t('flags an excluded path',
  cp('COPY ./dist/bundle.js /app/').issues.some(i => /excluded by your \.dockerignore/.test(i.title)), true);
t('a re-included path is not flagged as excluded',
  cp('COPY ./dist/manifest.json /app/').issues.some(i => /excluded by your/.test(i.title)), false);
t('a clean path has no blocking issue',
  cp('COPY ./src/index.js /app/').issues.filter(i => i.sev === 'bad').length, 0);
t('an unknown path is flagged as not in the list',
  cp('COPY ./nope.js /app/').issues.some(i => /not in the list/.test(i.title)), true);

console.log('--- the page sample behaves as documented ---');
const SR = '# the classic monorepo mistake\nnode_modules\n*.log\n.git\n\ndist\n!dist/manifest.json\n\n.env*\n!.env.example';
const SP = ['package.json', 'node_modules/react/index.js', 'packages/ui/node_modules/left-pad/index.js',
  'apps/web/node_modules/lodash/index.js', 'src/index.js', 'src/debug.log',
  'dist/bundle.js', 'dist/manifest.json', '.env.local', '.env.example', '.git/HEAD'];
const A = D.analyse(SR, SP.join('\n'));
const by = p => A.results.find(r => r.path === p);
t('root node_modules is excluded', by('node_modules/react/index.js').excluded, true);
t('nested node_modules is NOT — the whole point',
  by('packages/ui/node_modules/left-pad/index.js').excluded, false);
t('a second nested one is also missed', by('apps/web/node_modules/lodash/index.js').excluded, false);
t('a root log is excluded', by('src/debug.log').excluded, false);
t('dist is excluded', by('dist/bundle.js').excluded, true);
t('but the manifest is re-included', by('dist/manifest.json').excluded, false);
t('.env.local is excluded', by('.env.local').excluded, true);
t('.env.example is re-included', by('.env.example').excluded, false);
t('package.json is sent', by('package.json').excluded, false);
/* Two, not one: *.log is root-anchored here as well, so src/debug.log is still
   copied even though .gitignore users expect that pattern to match at any depth. */
t('the sample surfaces both divergences', A.divergence.length, 2);
t('names node_modules and *.log', A.divergence.map(d => d.rule.pattern).sort(), ['*.log', 'node_modules']);
t('the log divergence names the missed file',
  A.divergence.find(d => d.rule.pattern === '*.log').missed, ['src/debug.log']);
t('and suggests the globstar fix',
  A.divergence.find(d => d.rule.pattern === '*.log').fix, '**/*.log');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
