# Build queue

The daily ship task builds the **top unbuilt item that clears the gate**. It does not
invent ideas. If nothing clears, it ships nothing and says so.

## The gate

Every item must clear all four before a line of code is written:

1. **Volume** — one question above ~50k views, or ~100k combined.
   Check with `node scripts/research.mjs "<queries>"`; exit 0 means it passed.
2. **Tool-shaped** — the answer *branches on the user's input*. If the answer is
   "add this one line", it is documentation, and the top Stack Overflow answer
   already beats any tool. This is the check that was missing on day one.
3. **Weak incumbents** — existing tools are absent, paywalled, or solve a
   different problem. "It exists but is bad" needs to be specific about *how*.
4. **Client-side** — no network call, so the "nothing leaves your browser"
   promise on every page stays true.

## Ready

### 1. Docker build context / .dockerignore debugger — `/dockerignore`
- **Evidence:** "Docker: COPY failed: file not found in build context" — **205,162 views**, 53 pts.
- **Queries:** `docker copy file not found build context`, `dockerignore build context exclude`
- **Why tool-shaped:** simulate the ignore rules against a path list and say which
  line excluded the file COPY cannot find.
- **The wedge:** `.dockerignore` and `.gitignore` look identical and behave
  differently — Docker *does* let you re-include a file inside an excluded
  directory, git does not. Nothing documents that difference interactively, and
  the `/gitignore` matcher is most of the engine already.
- **Est:** 2h. **Score:** 8.0

### 2. Git undo decision tree — `/git-undo`
- **Evidence:** undo last commit 345,016 + rollback push 316,288 + undo to unstaged
  135,838 + undo last commit 182,397 ≈ **979,000 views**.
- **Queries:** `undo last git commit`, `git reset hard revert difference`
- **Why tool-shaped:** answer 3 questions (pushed yet? committed yet? want to keep
  the changes?) and get the one correct command plus what it destroys.
- **The wedge is the weakest part.** ohshitgit.com serves this well and ranks.
  Differentiator would be showing *what each option destroys* and refusing to
  suggest `--hard` without saying what is lost. **Validate the wedge before building.**
- **Est:** 2h. **Score:** 7.2

### 3. Cookie SameSite / third-party cookie debugger — `/cookies`
- **Evidence:** "Chrome blocking third party cookies, set SameSite=None" — 41,190
  views; Safari iframe SameSite — 10,872; localhost cookie — 5,542. **Needs revalidation**,
  combined is near the threshold.
- **Queries:** `cookie samesite secure not being set`, `chrome third party cookie blocked samesite`
- **Why tool-shaped:** given the cookie attributes and the context (top-level vs
  iframe, http vs https, same-site vs cross-site), compute whether it is sent.
- **Est:** 2.5h. **Score:** 7.0 (provisional)

## Blocked, with the reason

### SPF 10-lookup checker — `/spf`
Evidence is fine (81,542 combined, 54,212 on the biggest). **Fails gate 4:** it
needs live DNS. Doable over DNS-over-HTTPS, but that would make it the first tool
here to touch the network and would break the promise printed on every page.
**Do not build this unsupervised.** It is a product decision for Nikhil, not a
default. If approved, the page must say plainly that domains are sent to a
resolver.

### Mixed content, nginx 413, epoch conversion
**Fail gate 2.** High volume (938k, 795k, 347k) but the answer is a single line or
a solved commodity. Recorded here so they are not rediscovered and mistaken for
opportunities.

## Needs research before it can be queued

Nothing here is approved. Run `scripts/research.mjs` first; if it fails the gate,
delete the entry rather than building it anyway.

- Certificate chain order / missing intermediate — heavy build (ASN.1 parsing), evidence looked thin.
- Semver range expander — no clean high-volume question found in two attempts.
- SMS GSM-7 / UCS-2 segment counter — ~25k views. Below the gate on current evidence.
- `.env` quoting and precedence rules.
- OpenAPI diff / breaking-change detector.

---

## Honest note on how long this lasts

The strong-evidence queue is **three items deep**, and item 2's wedge is doubtful.
Automation does not manufacture demand evidence. Expect the queue to be exhausted
in under a week, at which point the task is designed to **stop and ask** rather
than ship filler — which is the exact failure the day-one set was criticised for.
Refilling it means a real research session, not a faster loop.
