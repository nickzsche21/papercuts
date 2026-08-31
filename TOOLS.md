# Tool Registry

**Challenge:** 30 genuinely useful internet tools in 7 days.
**Repo:** https://github.com/nickzsche21/papercuts
**Vercel project:** `papercuts`

| # | Tool | Status | Production | Build Time | Score | Category |
|---|------|--------|-----------|-----------|-------|----------|
| 06 | **CORS Error Decoder** | SHIPPED | [/cors](https://papercuts-mauve.vercel.app/cors) | ~3h | 9.7 | HTTP / Debugging |
| 07 | **CSP Violation Decoder** | SHIPPED | [/csp](https://papercuts-mauve.vercel.app/csp) | ~2.5h | 9.1 | Security |
| 01 | Will Excel break my CSV? | SHIPPED | [/csv-excel-guard](https://papercuts-mauve.vercel.app/csv-excel-guard) | ~2h | 9.4 | Data integrity |
| 02 | Invisible Character X-Ray | SHIPPED | [/invisible-characters](https://papercuts-mauve.vercel.app/invisible-characters) | ~1.5h | 7.4 | Text / Unicode |
| 03 | Nested JSON to CSV | SHIPPED | [/json-to-csv](https://papercuts-mauve.vercel.app/json-to-csv) | ~1.5h | 5.8 | Conversion |
| 04 | Will this filename break? | SHIPPED | [/filename-checker](https://papercuts-mauve.vercel.app/filename-checker) | ~1.5h | 5.4 | Files / Ops |
| 05 | Cron Collision Inspector | SHIPPED | [/cron-inspector](https://papercuts-mauve.vercel.app/cron-inspector) | ~2.5h | 7.9 | Ops / Dev |

**Day 2: tools 06 and 07** — the genuine top two, after re-running research with a stricter filter.
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
