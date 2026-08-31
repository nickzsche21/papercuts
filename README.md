# Papercuts

Tiny tools for tiny internet papercuts.

Single-purpose tools for small, specific, infuriating problems — the kind you solve by hand
every few weeks and never think to look up. Part of a 30-tools-in-7-days build.

**Live:** https://papercuts.tools (see `TOOLS.md` for the current production URL)

## The rules

- **One job per tool.** One input, one transformation, one useful result.
- **No account.** The tool is the page.
- **Nothing is uploaded.** Every tool runs entirely client-side — no server, no network
  request, no telemetry. Disconnect from the internet and they still work.
- **The output is the product.** Copy it, download it, or copy a report to send back to
  whoever caused the problem.

## Stack

Deliberately none. Static HTML, one shared stylesheet, one small shared JS helper module,
and a vanilla JS file per tool. No framework, no build step, no dependencies — for thirty
tiny client-side tools a bundler is pure tax. Deploys are instant and the payload is a few
kilobytes.

```
/index.html              hub
/assets/base.css         shared design system (light + dark)
/assets/base.js          shared helpers: copy, download, dropzone, formatting
/<tool-name>/index.html  one page per tool
/<tool-name>/app.js      that tool's engine, IIFE, exports a testable object on window
/vercel.json             clean URLs + security headers
```

Each tool's `app.js` exposes its pure functions on `window` (e.g. `window.PapercutsCSV`)
and bails out of DOM wiring when its root element is absent, so the engines can be loaded
and tested headlessly in Node with no DOM.

## Tests

Engine tests run in a Node `vm` sandbox against the real browser source — no duplication,
no test framework.

```bash
node test/test-csv.mjs && node test/test-xray.mjs && node test/test-json.mjs \
  && node test/test-names.mjs && node test/test-cron.mjs
```

268 assertions covering CSV parsing and Excel coercion rules, Unicode classification and
mojibake repair, JSON flattening and array modes, filename rules across six platforms, and
cron parsing with real timezone and DST arithmetic.

## Local development

Any static file server works. Note that with clean URLs a page served at `/tool-name`
(no trailing slash) resolves relative script paths against the site root, so every page
references its script absolutely as `/tool-name/app.js`.

```bash
npx serve --listen 4399 .
```

## Adding a tool

1. `mkdir tool-name`, add `index.html` (copy the header, footer and FAQ structure from any
   existing tool) and `app.js`.
2. Put the pure logic in functions, expose them on `window.PapercutsX`, and guard the DOM
   wiring with `if (!document.getElementById('input')) return;`.
3. Write a `test/test-x.mjs` against those exports.
4. Add a card to `index.html`, a `<url>` to `sitemap.xml`, and a row to `TOOLS.md`.
