# Research Log

## Method and its limits

**Reddit was not reachable.** Both scripted access and the browser are blocked by policy in
this environment, so no Reddit evidence appears below and none is invented. Everything here
comes from sources actually queried on 2026-08-31:

- **Stack Exchange API** (`api.stackexchange.com/2.3/search/advanced`) — view counts and
  scores are real figures returned by the API, not estimates.
- **HN Algolia API** (`hn.algolia.com/api/v1`) — comment and story search, including full
  thread traversal of the "tool you wish existed" Ask HN threads.
- **GitHub search API** via `gh`.

View count is the strongest available proxy for *recurring* pain: a question with 600k views
is one that hundreds of thousands of people hit independently and searched for.

---

## Problem cluster A — Excel silently destroys CSV data

Source: Stack Overflow
Community: Analysts, researchers, developers, ops
Problem statement: Excel type-guesses every cell on open and rewrites it to match the guess. There is no warning and no undo, and once saved the original value is gone.
Exact user pain: ZIP codes lose leading zeros. Barcodes and order IDs render as `1.23457E+12`. Gene names become dates. IDs over 15 digits are silently rounded to zeros. Accented names arrive as mojibake.
Current workaround: Manually prefixing apostrophes; re-importing through the text-import wizard and setting every column to Text; or discovering the corruption weeks later.
Existing solutions: Blog posts explaining one quirk each; converters that change format without auditing content; `="..."` wrapping done by hand.
Why they suck: Nothing audits a whole file and reports which specific cells will die. The knowledge is scattered across a dozen Stack Overflow answers.
Evidence:
- "Stop Excel from automatically converting certain text values to dates" — 639 pts / **669,387 views**
- "Excel to CSV with UTF8 encoding" — 651 pts / **902,622 views**
- "How to import long number from csv to excel without converting to scientific notation in VBA" — 100,330 views
- "How to save excel columns with long numbers into csv?" — 106,390 views
- Leading zeros: 46,595 + 45,531 + 22,467 + 22,454 + 14,730 = **151,777 views** across 5 questions
- Real-world: HGNC renamed human genes in 2020 specifically because of this bug.
Demand signal: recurring complaint + repeated manual workaround + institutional response.
Opportunity score: **9.4** → BUILT as tool 01

---

## Problem cluster B — invisible characters break string matching

Source: Stack Overflow
Community: Developers, data engineers, CMS and CRM users
Problem statement: Text copied from Word, Docs, PDFs, Slack or an LLM carries characters that occupy no visible width but change the bytes.
Exact user pain: Two identical-looking strings are unequal. Code will not compile. A CSV column will not join. A lookup fails with no visible cause.
Current workaround: Blind `.replace(/​/g,'')` chains copied from Stack Overflow, one character at a time.
Existing solutions: Generic whitespace strippers; regex snippets.
Why they suck: They fix the one character you already suspected. The actual problem is that you cannot see what is there, so you do not know what to strip.
Evidence:
- "JavaScript remove ZERO WIDTH SPACE (unicode 8203) from string" — 38,772 views
- "How to replace non-printable unicode characters (JavaScript)" — 45,598 views
- "Why isn't there a font that contains all Unicode glyphs?" — 56,468 views (adjacent confusion)
- Security dimension: Trojan Source (CVE-2021-42574) is this exact class of character weaponised.
Opportunity score: **8.9** → BUILT as tool 02

---

## Problem cluster C — nested JSON will not become a table

Source: Stack Overflow
Community: Analysts, data engineers
Problem statement: JSON is a tree, a spreadsheet is a rectangle, and flattening requires a decision the format cannot express.
Exact user pain: Converters emit `[object Object]`, or drop nested arrays, or produce one useless column per array index.
Current workaround: pandas `json_normalize` plus manual explode, or a bespoke script per API.
Existing solutions: Many free json-to-csv sites.
Why they suck: Almost none offer a true unnest (one row per array element with parent fields repeated), which is the mode analysis actually needs.
Evidence:
- "How to flatten multilevel/nested JSON?" — **175,613 views**
- "Convert Pandas Dataframe to nested JSON" — 51,371 views
- "Redirect output of mongo query to a csv file" — 161,501 views
Opportunity score: **8.2** → BUILT as tool 03

---

## Problem cluster D — cron is write-only

Source: Stack Overflow, HN
Community: Backend engineers, SREs
Problem statement: Cron syntax is hard to read, and real crontabs fail because of interactions *between* lines that no per-expression tool can see.
Exact user pain: Everything ends up scheduled at 3am and saturates the box. A job inside the daylight-saving gap is silently skipped for a whole year. `0 0 1 * MON` runs far more often than intended because of POSIX OR semantics.
Current workaround: crontab.guru, one line at a time, with the DST and collision questions simply unanswered.
Existing solutions: crontab.guru (dominant, excellent, single-expression only), various next-run calculators.
Why they suck: None take a whole file. None do DST arithmetic. None flag the day-of-month/day-of-week OR trap.
Evidence:
- "Using crontab to execute script every minute and another every 24 hours" — 321 pts / **694,311 views**
- "How do Cron 'Steps' Work?" — 26,009 views
- "Quartz: Cron expression that will never execute" — 127 pts / 204,846 views
- "A cron job that will never execute" — 148 pts / 168,434 views
Opportunity score: **7.9** → BUILT as tool 05

---

## Problem cluster E — cross-platform filename rules

Source: Vendor documentation, issue trackers
Community: Ops, IT, agencies, anyone shipping folders across platforms
Problem statement: Six platforms, six different definitions of a legal filename.
Exact user pain: SharePoint silently refuses half a folder. A Git repo cannot be checked out on macOS because two files differ only by case. `con.txt` cannot exist on Windows.
Current workaround: Find out when it breaks on someone else's machine, then rename by hand.
Existing solutions: Single-platform validators, mostly Windows-only.
Why they suck: They check one platform, and none check names *against each other* for case or Unicode-normalisation collisions — which is the failure that actually blocks a checkout.
Evidence: Weaker quantitative signal than A–D. Shipped on breadth of audience, strength of the sharing loop, and low build cost. **Flagged as the least evidence-backed of the five.**
Opportunity score: **8.0** → BUILT as tool 04

---

## Problem cluster F — epoch and timestamp conversion (REJECTED)

Evidence is strong:
- "Convert a Unix epoch timestamp into human readable date/time in Excel" — 100,492 views
- "How to convert epoch time with nanoseconds to human-readable?" — 118,761 views
- "Converting Epoch timestamp to SQL Server human readable format" — 127,973 views

**Rejected anyway.** epochconverter.com owns this query completely and solves it well. No
wedge, no novelty, nothing to add. High frequency alone is not enough — see rule 5.

---

## Signals captured for later cycles

- **Brand-name availability sweep.** HN comment, 2026-02-02: *"I spent 30+ hours manually checking brand names across a dozen sites... Existing tools are fragmented."* Real, first-person, quantified pain — but a crowded category and a much higher build cost (many network calls, rate limits, SSRF surface). Deferred.
- **JSONPath playground.** HN comment, 2026-04-12: a developer wanting a JSONPath equivalent of regex101 and finding nothing as good. Narrow but genuine.
- **Regex explained in plain English.** "Negative lookbehind equivalent in JavaScript" — 179 pts / 101,853 views; "javascript regex look behind alternative" — 160 pts / 132,185 views.
- **curl → fetch converter.** "How to convert a curl command to fetch()?" — 15,124 views. Small but clean intent.
- **CSV diff by key.** No single dominant question, but the workaround ("I wrote a script for this") pattern is dense.

## Ideas explicitly rejected

- Generic AI wrappers of every kind (rule 5).
- Anything needing auth, a database, or per-request cost — it would break the no-login,
  nothing-uploaded, zero-marginal-cost model that makes this set shippable at this pace.
- The Ask HN "tool you wish existed" threads turned out to be a poor source: the answers are
  mostly large, hard, infrastructure-shaped wishes (call-graph explorers, disposable SSH
  containers, physical/digital whiteboards), not the small-transformation shape this
  challenge needs. Stack Overflow view counts were far better signal.
