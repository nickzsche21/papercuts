# Research Log

## Method and its limits

**Reddit is unreachable** in this environment (scripted and browser both blocked by policy), so
no Reddit evidence appears here and none is invented. All figures below are real view counts
returned by the **Stack Exchange API**, plus **HN Algolia** and competitive checks via search.

View count is the best available proxy for *recurring* pain: a question with 6M views is one
that millions of people hit independently and searched for.

## The filter that actually matters

Raw volume is not worthiness. The question that separates a tool from a blog post:

> **Is the answer a lookup, or a computation?**

If the answer is "add this one line," it is documentation — no tool can beat the top Stack
Overflow answer. If the answer *branches on the user's specific input*, a tool wins. This is
the filter I failed to apply on day 1, which is how a commodity JSON→CSV converter ended up
in the top five.

Applying it kills several high-volume candidates outright:

| Candidate | Views | Killed because |
|---|---|---|
| nginx 413 upload limit | ~795k | The answer is one config line. Not tool-shaped. |
| Mixed-content blocked | ~938k | The answer is "use https". Not tool-shaped. |
| Epoch/timestamp conversion | ~347k | Trivial, and epochconverter.com owns it completely. |
| 502 Bad Gateway | ~247k | Diagnosis requires server access a web page cannot have. |

---

## Cluster 1 — CORS. The single biggest developer pain on the internet.

Source: Stack Overflow
Problem statement: The browser blocks a cross-origin request and emits an error that names a
header but not a cause, a fix, or which of the two machines is at fault.
Exact user pain: The error blames a header the developer has never set, on a server they may
not control. It "works in Postman" (because CORS is browser-only), so they conclude the server
is fine and spend hours trying to fix it from the frontend — which is impossible.
Current workaround: Paste the error into Google, land on one of a dozen answers written for a
different stack, try `Access-Control-Allow-Origin: *`, break credentials, try again.

Evidence (real view counts):

| Question | Views | Score |
|---|---:|---:|
| Why does my JavaScript receive a "No 'Access-Control-Allow-Origin' header" error | **6,593,894** | 3,369 |
| No 'Access-Control-Allow-Origin' header is present on the requested resource | **4,348,557** | 1,378 |
| Redirect has been blocked by CORS policy | **1,945,518** | 203 |
| Cannot use wildcard in ACAO when credentials flag is true | **861,499** | 520 |
| CORS: credentials mode is 'include' | **342,008** | 172 |
| Flutter web API CORS error | **303,937** | 164 |
| CloudFront: font blocked by CORS | **293,527** | 176 |
| Why is this CORS request failing only in Firefox? | 87,748 | 67 |
| Nginx add headers and proxy_pass for CORS (serverfault) | 58,155 | 6 |
| **Total** | **~14.8M** | |

Existing solutions and why they fail:
- **Request firers** (CORS Tester extension, test-cors.org) — send a request and show headers.
  They cannot reproduce *your* failing request with *your* cookies, and they diagnose nothing.
- **Generic header builders** (IO Tools CORS Headers Builder) — emit boilerplate that ignores
  your actual error and your actual origin.
- **Blog posts** — dozens, each written for one stack.

Nobody takes the error string the browser actually printed and turns it into the exact config
for the server you actually run. That is a pure string-parse plus decision tree — 100%
client-side, no network, no cost.
Tool-shaped: **yes** — 14 distinct failure modes × 12 server stacks.
Opportunity score: **9.7** → **BUILDING NOW as tool 06**

---

## Cluster 2 — Content Security Policy

Source: Stack Overflow
Problem statement: CSP blocks a resource and reports a directive, not a remedy. Writing a
correct policy from scratch is genuinely hard, and every violation is a puzzle about which
directive to widen and by how little.
Exact user pain: "Refused to execute inline script because it violates the following Content
Security Policy directive" — and the safe fix (a nonce or a hash) is not obvious, so people
paste `unsafe-inline` and silently delete the protection they installed CSP for.

Evidence:

| Question | Views | Score |
|---|---:|---:|
| Content Security Policy: the page's settings blocked loading of a resource | **579,507** | 202 |
| How does Content Security Policy (CSP) work? | **436,453** | 387 |
| Refused to execute inline script because it violates CSP | **278,235** | 73 |
| Refused to execute inline event handler (SANDBOX) | **169,795** | 86 |
| **Total** | **~1.46M** | |

Existing solutions and why they fail: Google's **csp-evaluator** is excellent but does a
different job — it audits an existing policy for weakness. It does not take your violation
messages and tell you the minimal directive that unblocks you without opening a hole. MDN
documents the directives but will not read your console output.
Tool-shaped: **yes** — violations → directive mapping, plus policy synthesis and a
strictness grade.
Opportunity score: **9.1** → **BUILDING NOW as tool 07**

---

## Cluster 3 — Excel destroys CSV data  *(shipped, tool 01)*

| Question | Views |
|---|---:|
| Stop Excel from automatically converting text values to dates | **669,387** |
| Excel to CSV with UTF8 encoding | **902,622** |
| Long numbers to scientific notation (two questions) | 206,720 |
| Leading zeros (five questions) | 151,777 |

~1.9M views. Real-world confirmation: HGNC renamed human genes in 2020 over this.
Tool-shaped: yes — per-cell analysis of a whole file. Opportunity score **9.4**.

## Cluster 4 — Cron  *(shipped, tool 05)*

"crontab every minute and another every 24 hours" — 694,311 views; "cron that will never
execute" — 168,434 + 204,846. Tool-shaped: yes (whole-file collisions, DST). Score **7.9**.

## Cluster 5 — Invisible characters  *(shipped, tool 02)*

Zero-width space removal 38,772 + non-printable Unicode 45,598. Smaller than I claimed the
value of on day 1 — the Trojan Source angle is the real hook, not the volume. Score **7.4**
(revised down from 8.9).

## Cluster 6 — Nested JSON → CSV  *(shipped, tool 03 — should not have been top five)*

175,613 views is real, but konklone.io, csvjson.com and jsonformatter.org own the query with
domain authority I will never beat, and the problem is a solved commodity. The `explode` mode
is a genuine differentiator attached to a category not worth entering. **Revised score 5.8.**

## Cluster 7 — Filenames  *(shipped, tool 04 — weakest)*

No quantitative demand signal found, before or after re-research. Shipped on judgment.
**Revised score 5.4.** Kept live because it works and cost little, but it does not belong in
a "worthy 30" on evidence.

---

## Signals captured, ranked but not yet built

- **Cache-Control behaviour matrix** — 563,108 + 51,086 + 13,328 ≈ 627k views. Tool-shaped:
  header combination → concrete browser/CDN behaviour, which is a real computation.
- **Regex → plain English** — 274,632 + 197,956 + 134,013 + 125,685 ≈ 733k. Tool-shaped, but
  regex101 already explains patterns; the wedge is narrower than the volume suggests.
- **git undo decision tree** — 345,016 + 316,288 + 182,397 + 135,838 ≈ 979k. Big, but
  ohshitgit.com and the Git docs serve it well. Medium wedge.
- **.gitignore "file is still tracked"** — 101,526 views. Small but perfectly tool-shaped:
  simulate the ignore rules against a real path list and emit the exact `git rm --cached`.
- **SPF 10-lookup limit** — 54,211 + 16,442 + 7,752 ≈ 78k. Low volume, very high stakes
  (email stops being delivered). Needs DNS, but DNS-over-HTTPS works from the browser.
  MXToolbox is clunky and paywalled. A sleeper.
- **Semver range expander** — no clean SO query found; judgment call, low confidence.
- **CSV diff by key** — 67,504 + 13,487 ≈ 81k.
- **SMS GSM-7 / UCS-2 segment counter** — 23,610 + 1,172. Low volume, direct money impact.
- **ffmpeg aspect-ratio / resolution** — 121,348 views.
