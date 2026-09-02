# Tool Registry

**Challenge:** 30 genuinely useful internet tools in 7 days.
**Repo:** https://github.com/nickzsche21/papercuts
**Vercel project:** `papercuts`

| # | Tool | Status | Production | Build Time | Score | Category |
|---|------|--------|-----------|-----------|-------|----------|
| 14 | **Watch your regex explode** | SHIPPED | [/regex-backtrack](https://papercuts-mauve.vercel.app/regex-backtrack) | ~3h | 9.0 | Regex / Performance |
| 06 | **CORS Error Decoder** | SHIPPED | [/cors](https://papercuts-mauve.vercel.app/cors) | ~3h | 9.7 | HTTP / Debugging |
| 07 | **CSP Violation Decoder** | SHIPPED | [/csp](https://papercuts-mauve.vercel.app/csp) | ~2.5h | 9.1 | Security |
| 08 | **Cache-Control Simulator** | SHIPPED | [/cache-control](https://papercuts-mauve.vercel.app/cache-control) | ~2h | 8.6 | HTTP / Performance |
| 09 | **Why isn't my .gitignore working?** | SHIPPED | [/gitignore](https://papercuts-mauve.vercel.app/gitignore) | ~2h | 8.3 | Git / Debugging |
| 10 | **Will my regex work everywhere?** | SHIPPED | [/regex-flavours](https://papercuts-mauve.vercel.app/regex-flavours) | ~2.5h | 8.8 | Regex / Portability |
| 11 | **CSV Diff by key** | SHIPPED | [/csv-diff](https://papercuts-mauve.vercel.app/csv-diff) | ~2h | 7.6 | CSV / Data |
| 12 | **Will this survive being pasted?** | SHIPPED | [/paste-damage](https://papercuts-mauve.vercel.app/paste-damage) | ~2h | 7.5* | Text / Cursed |
| 01 | Will Excel break my CSV? | SHIPPED | [/csv-excel-guard](https://papercuts-mauve.vercel.app/csv-excel-guard) | ~2h | 9.4 | Data integrity |
| 02 | Invisible Character X-Ray | SHIPPED | [/invisible-characters](https://papercuts-mauve.vercel.app/invisible-characters) | ~1.5h | 7.4 | Text / Unicode |
| 03 | Nested JSON to CSV | SHIPPED | [/json-to-csv](https://papercuts-mauve.vercel.app/json-to-csv) | ~1.5h | 5.8 | Conversion |
| 04 | Will this filename break? | SHIPPED | [/filename-checker](https://papercuts-mauve.vercel.app/filename-checker) | ~1.5h | 5.4 | Files / Ops |
| 05 | Cron Collision Inspector | SHIPPED | [/cron-inspector](https://papercuts-mauve.vercel.app/cron-inspector) | ~2.5h | 7.9 | Ops / Dev |

**Day 2: tools 06-09.** CORS and CSP first, then Cache-Control and .gitignore from the same ranked queue.
**Day 1: tools 01-05.** All seven verified in production. Last verified: 2026-08-31.

Scores for tools 02, 03 and 04 were revised **down** after re-research. Tool 03 (JSON to CSV)
is a commodity that should not have shipped in a top five, and tool 04 had no demand evidence.
See RESEARCH.md for the filter that catches this: *is the answer a lookup, or a computation?*

420 assertions across seven engines:
```bash
for s in csv xray json names cron cors csp; do node test/test-$s.mjs; done
```

---

# 01 — Will Excel break my CSV?

URL: /csv-excel-guard
Status: SHIPPED
Date: 2026-08-31
Problem: Excel silently and irreversibly rewrites CSV cells on open — no warning, no undo.
Target user: Anyone who sends or receives CSVs — analysts, ops, researchers, developers.
One-line description: Drop a CSV, see every cell Excel will destroy, download a version that survives.
Input: CSV/TSV file (up to 20 MB) or pasted CSV text.
Output: Per-cell findings table, worst-columns summary, Excel-safe CSV, sanitised CSV, and a copyable report to send back to the sender.
Why it exists: The single densest cluster of first-person pain I found. It is not an edge case — the HUGO Gene Nomenclature Committee formally renamed human genes in 2020 because Excel kept turning `SEPT1` into `1-Sep`.
Research signal:
- "Stop Excel from automatically converting certain text values to dates" — 639 pts / **669,387 views** (Stack Overflow)
- "Excel to CSV with UTF8 encoding" — 651 pts / **902,622 views**
- "Import long number from csv without scientific notation" — 100,330 views
- "Save excel columns with long numbers into csv" — 106,390 views
- Leading-zero loss across 5 questions — **151,777 combined views**
Build time: ~2h
Tech: Vanilla JS, RFC4180 parser written from scratch, 15 coercion rules, zero dependencies.
Distribution: The sharing loop is built into the product — "Copy report to send back" generates a message you paste to whoever sent you the broken file.
SEO keywords: excel csv date conversion, excel removing leading zeros csv, csv scientific notation fix, stop excel converting text to dates, excel csv corruption
Opportunity score: 9.4
What makes it different: Every existing tool either converts CSVs or explains one Excel quirk in a blog post. Nothing audits a whole file and tells you exactly which cells die. It also flags CSV formula injection (CWE-1236), which is a security finding, not just a formatting one.
Future improvements: XLSX export; a "paste from clipboard" path; per-column force-text toggles.

---

# 02 — Invisible Character X-Ray

URL: /invisible-characters
Status: SHIPPED
Date: 2026-08-31
Problem: Two strings look identical and are not equal. The offending character is, by definition, invisible.
Target user: Developers, data people, writers, anyone pasting out of Word/Docs/Slack/PDFs/LLMs.
One-line description: Paste text, see every invisible character named and highlighted, strip them in one click.
Input: Pasted text (up to 2M characters).
Output: Inline x-ray with a labelled chip per offending character, a breakdown table with code points and consequences, and a configurable cleaner with live output.
Why it exists: The character you need to find cannot be seen, so the normal debugging loop (look at it) fails completely.
Research signal:
- "JavaScript remove ZERO WIDTH SPACE (unicode 8203) from string" — 38,772 views
- "How to replace non-printable unicode characters (JavaScript)" — 45,598 views
- "Excel to CSV with UTF8 encoding" — 902,622 views (the mojibake half of the same problem)
Build time: ~1.5h
Tech: Vanilla JS, ~40-entry Unicode database, Windows-1252 reverse map for run-wise mojibake repair via `TextDecoder(fatal:true)`.
Distribution: Strong developer-community fit; the Trojan Source angle is the hook.
SEO keywords: remove zero width space, find invisible characters in text, non breaking space remover, fix mojibake, homoglyph detector
Opportunity score: 8.9
What makes it different: Existing tools strip whitespace. This one *names* each character, explains the consequence, flags bidirectional overrides as a security issue (Trojan Source, CVE-2021-42574), detects Cyrillic/Greek homoglyphs while correctly suppressing that check on genuinely Cyrillic or Greek text, and repairs mojibake run-by-run rather than requiring the whole string to round-trip.
Future improvements: Diff view against the cleaned text; per-character click-to-remove; file upload.

---

# 03 — Nested JSON to CSV

URL: /json-to-csv
Status: SHIPPED
Date: 2026-08-31
Problem: A spreadsheet is a rectangle, JSON is a tree, and most converters resolve that by emitting `[object Object]`.
Target user: Analysts and developers pulling API responses into a spreadsheet.
One-line description: Flatten deeply nested JSON or NDJSON into a real CSV, with array handling you choose.
Input: JSON, JSON array, or NDJSON — pasted or uploaded (up to 25 MB).
Output: Live preview table, column picker, CSV download with UTF-8 BOM, CSV to clipboard.
Why it exists: Everybody hits this and the existing free tools handle nested arrays badly.
Research signal:
- "How to flatten multilevel/nested JSON?" — **175,613 views** (Stack Overflow)
- "Convert Pandas Dataframe to nested JSON" — 51,371 views
- "Redirect output of mongo query to a csv file" — 161,501 views
Build time: ~1.5h
Tech: Vanilla JS recursive expander with cartesian row cross-product, capped at 200k rows.
Distribution: Pure SEO play — the search intent already exists at volume.
SEO keywords: nested json to csv, flatten json online, json to excel converter, ndjson to csv, json array to spreadsheet
Opportunity score: 8.2
What makes it different: The **explode** mode — a real unnest that gives each array element its own row with parent fields repeated, which is what analysis actually needs and what most converters do not offer. Plus NDJSON auto-detection, a column picker, and a cross-link to tool 01 because a flattened CSV full of long IDs is exactly what Excel destroys.
Future improvements: Choose which single array to explode rather than all; XLSX output; JSONPath root selector.

---

# 04 — Will this filename break?

URL: /filename-checker
Status: SHIPPED
Date: 2026-08-31
Problem: Every OS and sync tool has different filename rules, and you find out at the worst moment.
Target user: Ops, IT, agencies, anyone shipping a folder of files to someone on a different platform.
One-line description: Check filenames against Windows, macOS, Linux, SharePoint, S3 and Git, and get safe replacements.
Input: Filenames pasted one per line, or a local folder (names only — contents are never read).
Output: Per-platform pass/warn/fail matrix, explanations, safe replacement names, collision detection, and a copyable `mv` rename script.
Why it exists: The failure is always remote — the name works on your machine and breaks on theirs, so you cannot reproduce it.
Research signal: Cross-platform filename rules are documented but scattered across vendor docs; the recurring pain (SharePoint sync refusals, Git case-collision checkout failures, Windows reserved device names) shows up constantly in support and issue trackers. Weaker direct-quantitative evidence than tools 01–03; shipped on breadth-of-audience and the strength of the sharing loop.
Build time: ~1.5h
Tech: Vanilla JS, ~18 rules across 6 platforms, `TextEncoder` for real byte-length limits, NFC comparison for Unicode collisions.
Distribution: "Send this to whoever names the files" — high workplace shareability.
SEO keywords: illegal filename characters windows, sharepoint invalid file name, filename length limit, git case sensitive filename collision, safe filename checker
Opportunity score: 8.0
What makes it different: Checks six platforms at once and, crucially, checks names *against each other* — case collisions and Unicode-normalisation collisions are invisible to any per-name validator and are exactly what breaks a Git checkout.
Future improvements: PowerShell rename script; a paste-a-zip-listing mode; per-platform toggles.

---

# 05 — Cron Collision Inspector

URL: /cron-inspector
Status: SHIPPED
Date: 2026-08-31
Problem: Cron tools explain one expression. Real crontabs fail because of interactions between lines.
Target user: Backend and platform engineers, SREs, anyone maintaining a crontab.
One-line description: Paste a whole crontab and find the collisions, the DST traps, and the lines that never run.
Input: A crontab — expressions, commands and comments, plus a timezone.
Output: Plain-English description and next fire times per line, cross-line collision table, 7-day×24-hour heatmap, and a copyable report.
Why it exists: crontab.guru owns single-expression explanation, but nothing answers "what does my whole file do together".
Research signal:
- "Using crontab to execute script every minute and another every 24 hours" — 321 pts / **694,311 views**
- "How do Cron 'Steps' work?" — 26,009 views
- "Quartz: Cron expression that will never execute" — 127 pts
Build time: ~2.5h
Tech: Vanilla JS cron parser, wall-clock iteration, real DST transition detection by offset scan plus bisection using the browser's own IANA timezone database. Formatters cached per zone; a 7-day scan of an every-minute job runs in ~110ms.
Distribution: HN and r/sysadmin-shaped; the DST-skip finding is the "I didn't know that was possible" hook.
SEO keywords: cron expression tester, crontab next run time, cron daylight saving time problem, cron jobs overlapping, cron never runs
Opportunity score: 7.9
What makes it different: Three things no other cron tool does — (1) cross-line collision detection, (2) genuine DST arithmetic that names the exact date a job is skipped or doubled, (3) flagging the POSIX day-of-month/day-of-week **OR** trap, which almost everyone gets wrong.
Future improvements: Suggested stagger times; export a fixed crontab; Kubernetes CronJob and GitHub Actions schedule syntax.

---

# 06 — CORS Error Decoder

URL: /cors
Status: SHIPPED
Date: 2026-08-31
Problem: The browser blocks a cross-origin request and prints an error that names a header but not a cause, not a culprit, and not a fix.
Target user: Every web developer. This is the highest-volume developer problem on the internet.
One-line description: Paste the CORS error, get the diagnosis and the exact server config that fixes it.
Input: The error string from the browser console. Optionally the request shape — method, content type, custom headers, credentials.
Output: Named failure mode, which machine is at fault, what actually happened, numbered fix steps, a preflight prediction, and copy-paste config for 14 server stacks with the real origin substituted in.
Why it exists: ~14.8M Stack Overflow views across the CORS questions. Every existing tool either fires a request — useless, because it cannot reproduce your failing call with your cookies — or emits generic boilerplate that ignores your error. Nobody maps your error to your fix.
Research signal:
- "Why does my JavaScript receive a No Access-Control-Allow-Origin error" — **6,593,894 views** / 3,369 pts
- "No Access-Control-Allow-Origin header is present" — **4,348,557 views** / 1,378 pts
- "Redirect has been blocked by CORS policy" — **1,945,518 views**
- "Cannot use wildcard in ACAO when credentials flag is true" — **861,499 views** / 520 pts
- "CORS: credentials mode is include" — **342,008 views**
- Flutter, CloudFront, Firefox and nginx variants — **~14.8M total**
Build time: ~3h
Tech: Vanilla JS. 14 ordered failure-mode rules matched against real Chrome, Firefox and Safari strings; origin, target and status extraction; a preflight predictor implementing the CORS safelist rules; 14 config generators.
Distribution: The error string is itself the search query — people paste it into Google verbatim. The highest-intent SEO available anywhere in this list.
SEO keywords: no access-control-allow-origin fix, blocked by cors policy, cors preflight 401, wildcard credentials cors, response to preflight request doesn't pass access control check
Opportunity score: 9.7
What makes it different: It reads *your* error. It names which machine must change — the most common misconception in the whole category is that CORS is fixable from the calling page. It predicts whether a preflight even happens, which is a real computation from method plus content type plus headers. And the generated configs carry the expertise: nginx add_header inside an if block replacing the outer headers, ASP.NET UseCors ordering, Spring Security needing its own CORS pass, Starlette silently downgrading wildcard-plus-credentials, CloudFront needing Origin forwarded in the cache key.
Future improvements: Infer the framework from the URL shape; a "paste your current response headers" mode; per-failure-mode deep links for SEO.

---

# 07 — CSP Violation Decoder

URL: /csp
Status: SHIPPED
Date: 2026-08-31
Problem: A Content-Security-Policy violation names a directive and stops. The fastest fix — adding unsafe-inline — silently deletes the protection CSP exists to provide.
Target user: Web developers rolling out or maintaining a CSP.
One-line description: Paste the violations, get the smallest policy that unblocks them, with a grade showing what each concession costs.
Input: One or many console violation lines, plus optionally the current policy.
Output: Per-violation breakdown, a synthesised policy, a nonce/hash/unsafe-inline choice with the safe option first, a 0-100 strictness grade with before and after, and deployment snippets for five targets plus a meta tag.
Why it exists: ~1.46M views, and the obvious fix is the wrong one. Google's csp-evaluator audits an existing policy for weakness; it does not read your violations and build the minimal policy that unblocks you.
Research signal:
- "Content Security Policy: the page's settings blocked loading of a resource" — **579,507 views**
- "How does Content Security Policy (CSP) work?" — **436,453 views** / 387 pts
- "Refused to execute inline script because it violates CSP" — **278,235 views**
- "Refused to execute inline event handler (SANDBOX)" — **169,795 views**
Build time: ~2.5h
Tech: Vanilla JS. 15 violation patterns, a directive knowledge base carrying the real fallback chain, policy synthesis with source-expression derivation from blocked URLs, and a weighted grader.
Distribution: Same shape as CORS — the violation text is the search query.
SEO keywords: refused to execute inline script csp, content security policy directive fix, csp nonce vs hash, unsafe-inline alternative, csp policy generator
Opportunity score: 9.1
What makes it different: It defaults to a nonce and marks unsafe-inline as the last resort it is — and the grade visibly drops from A to C when you select it, so the tool teaches the tradeoff instead of hiding it. It also knows the traps: that a nonce silently disables unsafe-inline, and that frame-ancestors, form-action and base-uri never fall back to default-src, so it adds the free hardening most real policies omit.
Future improvements: Accept report-uri JSON payloads; compute real SHA-256 hashes from pasted script bodies; per-directive deep links.

---

# 08 — Cache-Control Simulator

URL: /cache-control
Status: SHIPPED
Date: 2026-09-01
Problem: Caching directives describe intent, not behaviour, and several of them quietly cancel each other out.
Target user: Web and backend developers, anyone tuning a CDN.
One-line description: Paste your caching headers and see what actually happens, scenario by scenario.
Input: Response headers, or a bare Cache-Control value.
Output: Plain-English verdict, a freshness timeline, a nine-row scenario table (first visit, revisit, expiry, reload, hard reload, back/forward, CDN, stale-while-revalidate, origin down), and a contradiction report.
Why it exists: The directives are individually documented everywhere and their *interactions* are documented nowhere.
Research signal:
- "Difference between max-age=0 and no-cache" — 746 pts / **563,108 views**
- "Difference between no-cache and must-revalidate" — 245 pts / **207,375 views**
- Plus 51,086 + 21,382 + 13,328 on related revalidation confusion — **~856k views** on directive interaction alone
Build time: ~2h
Tech: Vanilla JS. Directive parser, freshness-lifetime resolver including HTTP heuristic caching, scenario engine, 17 contradiction rules.
Distribution: Strong SEO on the exact directive-comparison queries; the "you are getting heuristic caching you did not ask for" finding is the shareable moment.
SEO keywords: cache-control no-cache vs no-store, max-age vs must-revalidate, s-maxage explained, stale-while-revalidate, why is my css cached
Opportunity score: 8.6
What makes it different: Existing tools either restate the spec or fire a request at a URL. This one simulates *situations* — the fact that a normal reload revalidates while a link click does not is why most people's manual cache testing is misleading. It also flags heuristic caching, which is the cause of "I never set caching and my users see stale files", and strikes through directives that other directives have already cancelled.
Future improvements: Per-CDN semantics (Cloudflare, Fastly, CloudFront differ); a "generate the header I want" reverse mode.

---

# 09 — Why isn't my .gitignore working?

URL: /gitignore
Status: SHIPPED
Date: 2026-09-01
Problem: A .gitignore rule appears correct and the file is still tracked, with no feedback about which rule decided what.
Target user: Every developer using git.
One-line description: See which single line decides each path, and why the re-include you wrote never runs.
Input: Your .gitignore, plus paths to test (`git ls-files` pastes straight in).
Output: Per-path verdict naming the deciding line number, detection of the excluded-parent trap with the corrected pattern, and `git rm --cached` commands for files that are already tracked.
Why it exists: Git tells you nothing about *why* a path is or is not ignored, and the two most common causes are both invisible.
Research signal:
- ".gitignore does not work - file is still being tracked" — 84 pts / **101,526 views**
- "git track, ignore, delete, untrack" — 13,997 views; "still shows files as untracked despite .gitignore and rm -r --cached" — 3,429; plus related — **~127k views**
Build time: ~2h
Tech: Vanilla JS reimplementation of git's ignore matching — anchoring, negation, directory-only patterns, character classes, `**` globs, last-match-wins, and the rule that an excluded directory is never descended into.
Distribution: Universal developer audience; the trap explanation is the "I didn't know that" hook.
SEO keywords: gitignore not working, gitignore file still tracked, git rm cached, gitignore negation not working, gitignore exclude subdirectory
Opportunity score: 8.3
What makes it different: `git check-ignore -v` names a matching rule but only for one path, only inside a repo, and it says nothing about the two real causes — that the file is already tracked, and that a re-include under an excluded directory can never fire. This explains both and emits the fix.
**Verification note:** the matcher is differential-tested against real `git check-ignore` — 24 of 24 paths agree, covering anchoring, globstars, character classes, negation ordering and the trap case.
Future improvements: Multiple nested .gitignore files; global excludes and .git/info/exclude; drag a folder to read real paths.

---

# 10 — Will my regex work everywhere?

URL: /regex-flavours
Status: SHIPPED
Date: 2026-09-01
Problem: "Regular expression" is not one language. A pattern that passes in regex101 can be a syntax error in Go, and the failure appears only in production.
Target user: Anyone moving a pattern between languages, or writing one for a codebase they do not control.
One-line description: Paste a regex and see which engines support what you used, with the rewrite where one exists.
Input: A regular expression.
Output: Per-engine verdict across 10 engines, a feature-by-engine matrix, an explanation and a workaround for each construct used, a translated pattern for the Python/Go and JavaScript named-group syntaxes, and a catastrophic-backtracking warning.
Why it exists: The two most popular systems-language engines (Go and Rust) deliberately omit lookaround and backreferences, and nothing warns you before you ship.
Research signal:
- "Regex lookahead, lookbehind and atomic groups" — 738 pts / **679,437 views**
- "How to match, but not capture, part of a regex?" — 338 pts / **322,096 views**
- "javascript regex - look behind alternative?" — **132,185 views**
- "Negative lookbehind equivalent in JavaScript" — **101,855 views**
- **~1.23M views** on advanced-construct confusion
Build time: ~2.5h
Tech: Vanilla JS. A construct scanner that tracks escapes and character classes (so `[(?=]` is not mistaken for a lookahead), a fixed-versus-variable-width lookbehind analyser, an 18-feature by 10-engine support matrix, and a syntax translator.
Distribution: The "works in regex101, fails in Go" framing is the hook.
SEO keywords: regex lookbehind not supported, go regexp lookahead, regex compatibility python javascript, (?P<name>) vs (?<name>), redos catastrophic backtracking
Opportunity score: 8.8
What makes it different: regex101 lets you *pick* a flavour and shows failures one at a time. This answers the portability question directly — which of ten engines will reject this, why, and what to write instead — and it says plainly when there is no equivalent, which is the honest answer for lookaround in RE2.
**Verification note:** the JavaScript column is verified against the real V8 engine — 17 constructs compiled under the `u` flag, 0 disagreements with the table. The `\p{L}` partial marking is backed by a test showing that without the flag it silently means the literal text `p{L}`.
Future improvements: More engines (Perl, Swift, Elixir); a per-engine "will this compile" live check where an engine is available in the browser.

---

# 11 — CSV Diff by key

URL: /csv-diff
Status: SHIPPED
Date: 2026-09-01
Problem: A text diff on a CSV is noise the moment the export reorders rows.
Target user: Analysts, ops, anyone comparing two exports of the same dataset.
One-line description: Match rows by a key column and show only the cells that genuinely differ.
Input: Two CSVs, pasted or dropped.
Output: Added, removed and changed rows with per-cell before and after, a column-level diff, duplicate-key warnings, and a downloadable diff CSV.
Why it exists: The operation people want is a join, and every general-purpose diff tool offers a line comparison instead.
Research signal: "Comparing two csv files" and related — ~81k views. Lower volume than the other tools shipped today, and recorded as such.
Build time: ~2h
Tech: Vanilla JS. RFC4180 parser with delimiter detection, key inference, composite keys joined on NUL so that ("New","York") cannot collide with "New York".
Distribution: Pairs naturally with tool 01; both are linked from each other.
SEO keywords: compare two csv files, csv diff by column, diff csv ignore row order, find changed rows csv
Opportunity score: 7.6
What makes it different: Row order is ignored by construction, added columns do not mark every row as modified, and duplicate keys are reported as ambiguous rather than silently paired with whichever row came first.
Future improvements: Fuzzy matching for near-duplicate keys; numeric tolerance so 1.0 and 1 can count as equal; three-way diff.

---

# 12 — Will this survive being pasted?

URL: /paste-damage
Status: SHIPPED
Date: 2026-09-01
Problem: Text is silently rewritten by the app it was written in, and the damage is invisible until it reaches something that parses it.
Target user: Anyone who writes a command into a runbook, a ticket or a chat for someone else to run.
One-line description: See what Word, Google Docs, Notion, Slack, Jira, a PDF, an iOS keyboard and an Excel cell each do to your text — and chain them.
Input: Any text, typically a shell command, a key or an identifier.
Output: Per-destination result with every changed character highlighted, what each rule did and why, a severity verdict, a configurable multi-hop chain showing compounding damage, and a fenced version that survives everywhere.
Why it exists: **This is the first deliberately weird tool in the set, and it exists because the worthiness gate could not have produced it.** The gate scores on Stack Overflow view counts, which selects for boring by construction — a problem nobody has a name for cannot have 600k views. Nikhil pointed out that 11 of 11 tools were sober utilities when the brief asked for 5–10 weird ones. Scored on recognition rather than volume.
Research signal: Deliberately none of the usual kind, and that is recorded honestly rather than back-filled. The underlying damage is well documented (smart quotes, autocorrect dashes, Jira underscore-eating, PDF ligatures) but nobody searches for it, because the failure is attributed to the command rather than to the transport.
Build time: ~2h
Tech: Vanilla JS. Eight destination models, each a list of real default-on transformations that records what it changed; a severity model distinguishing a lookalike substitution from outright deletion; a chain evaluator that feeds each output into the next.
Distribution: The chain is the shareable moment — watching a working command decay through three hops.
SEO keywords: smart quotes breaking command, em dash instead of double hyphen, jira removing underscores, pdf ligature copy paste, why does my command fail after copying
Opportunity score: 7.5 on recognition, not volume — recorded separately so it does not distort the evidence-scored table.
What makes it different: Every other tool in this set diagnoses damage after the fact. This one predicts it beforehand, and the chain view shows compounding, which is how it actually happens.
**Accuracy note:** three defects were found by testing. A wrapped replacement callback meant string replacements like `$1` were emitted literally; the Excel exponent gained a doubled sign; and, most usefully, the tests caught me asserting that Word mangles ` --header`, which it does **not** — Word only converts a double hyphen with text on both sides. That claim was drama, not behaviour, and the corrected expectation is now a regression test.
Future improvements: WhatsApp and Teams; a reverse mode that guesses which destination damaged text you are already holding.

---

# 14 — Watch your regex explode

URL: /regex-backtrack
Status: SHIPPED
Date: 2026-09-02
Problem: Catastrophic backtracking is invisible until it takes production down. You cannot see it in your editor, your tests pass, and the browser's own RegExp will not tell you how much work it did.
Target user: Anyone whose regex touches user input.
One-line description: A real backtracking regex engine that counts every step, so you can watch a pattern explode and then watch the fix collapse it.
Input: A pattern and a test string.
Output: A measured step count, a per-character visit heatmap showing exactly where the engine thrashes, a log-scale chart of steps against input length, a growth classification, a projection to 30/40/50 characters in human time, and one-click defusing with atomic groups and possessive quantifiers.
Why it exists: Existing ReDoS tooling either statically flags suspicious shapes (and cries wolf) or runs the pattern and times it (which tells you nothing about why). Nothing lets you *see* the backtracking happen.
Research signal: The regex-performance and ReDoS cluster sits alongside the ~1.23M views of advanced-construct confusion measured for tool 10. Real-world weight: a catastrophic backtracking pattern in a log-parsing rule took Cloudflare's global network down for roughly 30 minutes in July 2019.
Build time: ~3h
Tech: Vanilla JS, no dependencies. A complete recursive-descent regex parser and a continuation-passing backtracking matcher, instrumented to count and record every attempt. Supports literals, classes, shorthands, `.`, anchors, word boundaries, groups, alternation, and greedy, lazy, possessive and atomic repetition. Hard step cap of 5,000,000 so the tab always survives. Inline SVG chart, no charting library.
Distribution: The step counter going from 40 to four billion is the hook. It is the most screenshot-able thing in the set.
SEO keywords: catastrophic backtracking, redos regex, why is my regex slow, regex denial of service, atomic group possessive quantifier
Opportunity score: 9.0
What makes it different: It does not estimate. It implements the engine and measures. The visit heatmap is the part nothing else has — a single red spike over one character is the signature of the engine trying every possible division of the text.
**Verification note:** the engine's match/no-match verdict is differentially tested against the real JavaScript RegExp across 101 pattern/input pairs, with 0 disagreements. Step counts are this engine's own instrumentation and are labelled as measured; only the 30/40/50-character projection is an extrapolation, and the page says so.
**Defect found during the build:** growth was first measured over plain prefixes of the test string, which made `^(a+)+$` look *linear* — every prefix of `aaaa…!` is all `a`s and matches instantly, so the explosion never appeared. The blow-up lives on the failure path, so the failing tail is now preserved while the body grows. The classifier was also rewritten to use the log-log slope for polynomial growth rather than a single ratio threshold.
Future improvements: Step-by-step playback with a scrubber; import a pattern straight from /regex-flavours; detect the attack string automatically rather than asking for one.
