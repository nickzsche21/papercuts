/* Evidence check. Usage:
 *     node scripts/research.mjs "regex lookbehind" "golang regexp lookahead"
 *
 * Prints real Stack Overflow view counts for each query and a combined total.
 * The daily ship task runs this against the queue item it is about to build and
 * refuses to build if the evidence does not hold up — the guard against the
 * failure mode from day one, which was shipping on intuition and calling it
 * research. Reddit is unreachable from this environment, so it is not consulted.
 */
const SITE = 'stackoverflow';

async function ask(query, pagesize = 5) {
  const u = new URL('https://api.stackexchange.com/2.3/search/advanced');
  u.searchParams.set('order', 'desc');
  u.searchParams.set('sort', 'votes');
  u.searchParams.set('q', query);
  u.searchParams.set('site', SITE);
  u.searchParams.set('pagesize', String(pagesize));
  u.searchParams.set('filter', '!nNPvSNdWme');   /* includes view_count */
  const res = await fetch(u);
  if (!res.ok) throw new Error('Stack Exchange returned ' + res.status);
  const json = await res.json();
  return (json.items || []).map(i => ({
    views: i.view_count, score: i.score, title: i.title
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  }));
}

const queries = process.argv.slice(2);
if (!queries.length) {
  console.error('usage: node scripts/research.mjs "query" ["query" ...]');
  process.exit(2);
}

let total = 0, best = 0;
for (const q of queries) {
  console.log('\n' + q);
  try {
    const items = await ask(q);
    if (!items.length) { console.log('  (no results — the phrasing is probably too specific)'); continue; }
    for (const i of items) {
      console.log('  ' + String(i.views).padStart(9) + ' views  ' +
        String(i.score).padStart(5) + ' pts  ' + i.title.slice(0, 80));
      total += i.views;
      best = Math.max(best, i.views);
    }
  } catch (e) {
    console.log('  lookup failed: ' + e.message);
  }
  await new Promise(r => setTimeout(r, 400));   /* be polite to the API */
}

console.log('\n' + '-'.repeat(60));
console.log('Combined views across all results: ' + total.toLocaleString('en-US'));
console.log('Single biggest question:           ' + best.toLocaleString('en-US'));
console.log('\nWorthiness gate — a queue item should clear ALL of these:');
console.log('  1. A single question above ~50,000 views, or ~100,000 combined.');
console.log('  2. The answer BRANCHES on the user\'s input. If it is "add this one');
console.log('     line", it is documentation and no tool beats the top answer.');
console.log('  3. Existing tools are absent, paywalled, or solve a different problem.');
console.log('  4. It can run fully client-side with no network call.');
console.log('\nIf any of these fail, skip the item, record why, and move to the next.');
process.exit(best >= 50000 || total >= 100000 ? 0 : 1);
