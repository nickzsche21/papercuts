/* Cron Collision Inspector — 100% client-side. */
(function () {
  'use strict';
  const { $, esc, toast, copy, fmt } = window.PC;

  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const DOWS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const DOW_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON_LONG = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'];

  const MACROS = {
    '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *',
    '@hourly': '0 * * * *'
  };

  /* ---------------------------------------------------------------- parse */
  function parseField(spec, min, max, names, fieldName) {
    const set = new Set();
    let restricted = true;
    if (spec === '*' || spec === '?') { restricted = false; spec = min + '-' + max; }
    for (const part of spec.split(',')) {
      if (!part) throw new Error('Empty value in the ' + fieldName + ' field.');
      const m = /^(.+?)(?:\/(\d+))?$/.exec(part);
      const step = m[2] ? parseInt(m[2], 10) : 1;
      if (step < 1) throw new Error('Step of 0 in the ' + fieldName + ' field.');
      let lo, hi;
      const range = m[1];
      const val = s => {
        const up = s.toUpperCase();
        const idx = names ? names.indexOf(up) : -1;
        if (idx >= 0) return idx + (names === MONTHS ? 1 : 0);
        if (!/^\d+$/.test(s)) throw new Error('"' + s + '" is not valid in the ' + fieldName + ' field.');
        return parseInt(s, 10);
      };
      if (range === '*') { lo = min; hi = max; restricted = restricted && false; }
      else if (range.includes('-')) {
        const bits = range.split('-');
        if (bits.length !== 2) throw new Error('Bad range "' + range + '" in the ' + fieldName + ' field.');
        lo = val(bits[0]); hi = val(bits[1]);
      } else { lo = val(range); hi = m[2] ? max : lo; }
      if (lo < min || hi > max || lo > hi)
        throw new Error('"' + part + '" is out of range for the ' + fieldName +
          ' field (' + min + '-' + max + ').');
      for (let v = lo; v <= hi; v += step) set.add(v);
    }
    return { set: set, restricted: restricted };
  }

  function parseCron(expr) {
    let e = expr.trim();
    if (/^@reboot$/i.test(e)) return { reboot: true, raw: expr };
    const macro = MACROS[e.toLowerCase()];
    if (macro) e = macro;
    let f = e.split(/\s+/);
    let seconds = false;
    if (f.length === 6) { seconds = true; f = f.slice(1); }
    if (f.length !== 5)
      throw new Error('Expected 5 fields (minute hour day-of-month month day-of-week), got ' + f.length + '.');

    const min  = parseField(f[0], 0, 59, null, 'minute');
    const hour = parseField(f[1], 0, 23, null, 'hour');
    const dom  = parseField(f[2], 1, 31, null, 'day-of-month');
    const mon  = parseField(f[3], 1, 12, MONTHS, 'month');
    const dowR = parseField(f[4], 0, 7, DOWS, 'day-of-week');

    /* 7 and 0 are both Sunday */
    const dow = new Set();
    dowR.set.forEach(v => dow.add(v === 7 ? 0 : v));

    return { reboot: false, seconds: seconds, raw: expr,
      min: min.set, hour: hour.set, dom: dom.set, mon: mon.set, dow: dow,
      domR: dom.restricted, dowR: dowR.restricted, fields: f };
  }

  /* ----------------------------------------------------------- timezones */
  /* Constructing an Intl.DateTimeFormat is expensive and these run tens of
     thousands of times per inspection, so formatters are cached per zone. */
  const FMT = Object.create(null);
  function fmtFor(tz) {
    if (!FMT[tz]) FMT[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return FMT[tz];
  }

  function rawParts(date, tz) {
    const p = {};
    fmtFor(tz).formatToParts(date).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
    return p;
  }

  function offsetMinutes(date, tz) {
    const p = rawParts(date, tz);
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day,
      p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
    return (asUTC - date.getTime()) / 60000;
  }

  function partsIn(date, tz) {
    const p = rawParts(date, tz);
    return { y: +p.year, mo: +p.month, d: +p.day, h: p.hour === '24' ? 0 : +p.hour, mi: +p.minute };
  }

  /* Wall-clock in tz -> instant. null when that wall time does not exist. */
  function wallToUTC(y, mo, d, h, mi, tz) {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    let ts = guess - offsetMinutes(new Date(guess), tz) * 60000;
    ts = guess - offsetMinutes(new Date(ts), tz) * 60000;
    const p = partsIn(new Date(ts), tz);
    if (p.y !== y || p.mo !== mo || p.d !== d || p.h !== h || p.mi !== mi) return null;
    return new Date(ts);
  }

  /* DST transitions in tz within [from, to], found by scan then bisect. */
  function transitions(tz, from, to) {
    const out = [];
    const STEP = 6 * 3600 * 1000;
    let prev = new Date(from), prevOff = offsetMinutes(prev, tz);
    for (let t = from.getTime() + STEP; t <= to.getTime(); t += STEP) {
      const cur = new Date(t), off = offsetMinutes(cur, tz);
      if (off !== prevOff) {
        let lo = prev.getTime(), hi = t;
        while (hi - lo > 60000) {
          const mid = Math.floor((lo + hi) / 2);
          if (offsetMinutes(new Date(mid), tz) === prevOff) lo = mid; else hi = mid;
        }
        out.push({ at: new Date(hi), before: prevOff, after: off, delta: off - prevOff });
        prevOff = off;
      }
      prev = cur;
    }
    return out;
  }

  /* --------------------------------------------------------- fire times */
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  function dayMatches(c, y, mo, d) {
    if (!c.mon.has(mo)) return false;
    const dowNum = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    const domOk = c.dom.has(d), dowOk = c.dow.has(dowNum);
    /* POSIX: when both are restricted the job runs if EITHER matches. */
    if (c.domR && c.dowR) return domOk || dowOk;
    if (c.domR) return domOk;
    if (c.dowR) return dowOk;
    return true;
  }

  /* Yields wall-clock matches as {y,mo,d,h,mi}. */
  function* wallMatches(c, start, maxDays) {
    let { y, mo, d } = start;
    const startKey = start.h * 60 + start.mi;
    for (let day = 0; day < maxDays; day++) {
      if (dayMatches(c, y, mo, d)) {
        const hours = [...c.hour].sort((a, b) => a - b);
        const mins = [...c.min].sort((a, b) => a - b);
        for (const h of hours) for (const mi of mins) {
          if (day === 0 && h * 60 + mi < startKey) continue;
          yield { y: y, mo: mo, d: d, h: h, mi: mi };
        }
      }
      d++;
      if (d > dim(y, mo)) { d = 1; mo++; if (mo > 12) { mo = 1; y++; } }
    }
  }

  function nextFires(c, tz, now, count, maxDays) {
    const start = partsIn(now, tz);
    const out = [];
    for (const w of wallMatches(c, start, maxDays || 1500)) {
      const dt = wallToUTC(w.y, w.mo, w.d, w.h, w.mi, tz);
      if (dt === null) { out.push({ wall: w, date: null, skipped: true }); }
      else if (dt >= now) out.push({ wall: w, date: dt, skipped: false });
      if (out.length >= count) break;
    }
    return out;
  }

  /* --------------------------------------------------------- description */
  function listOf(set, max, fmtOne) {
    const a = [...set].sort((x, y) => x - y);
    if (a.length > max) return 'every value';
    return a.map(fmtOne || String).join(', ');
  }

  function stepOf(set, min, max) {
    const a = [...set].sort((x, y) => x - y);
    if (a.length < 2 || a[0] !== min) return null;
    const step = a[1] - a[0];
    for (let i = 1; i < a.length; i++) if (a[i] - a[i - 1] !== step) return null;
    if (a[a.length - 1] + step <= max) return null;
    return step;
  }

  function describe(c) {
    if (c.reboot) return 'Once, at system boot.';
    const bits = [];
    const everyMin = c.min.size === 60, everyHour = c.hour.size === 24;

    if (everyMin && everyHour) bits.push('Every minute');
    else if (everyMin) bits.push('Every minute during ' + listOf(c.hour, 6, h => pad(h) + ':00') + '');
    else {
      const ms = stepOf(c.min, 0, 59);
      const hs = stepOf(c.hour, 0, 23);
      if (ms && ms > 1 && everyHour) bits.push('Every ' + ms + ' minutes');
      else if (c.min.size === 1 && everyHour) bits.push('Every hour at :' + pad([...c.min][0]));
      else if (c.min.size === 1 && hs && hs > 1) bits.push('Every ' + hs + ' hours at :' + pad([...c.min][0]));
      else if (c.min.size === 1 && c.hour.size <= 6)
        bits.push('At ' + [...c.hour].sort((a, b) => a - b).map(h => pad(h) + ':' + pad([...c.min][0])).join(', '));
      else if (ms && ms > 1) bits.push('Every ' + ms + ' minutes during ' + listOf(c.hour, 8, h => pad(h) + ':00'));
      else bits.push('At minute ' + listOf(c.min, 8) + ' of hour ' + listOf(c.hour, 8));
    }

    const parts = [];
    if (c.domR) parts.push('on day ' + listOf(c.dom, 12) + ' of the month');
    if (c.dowR) parts.push('on ' + listOf(c.dow, 7, d => DOW_LONG[d]));
    if (c.mon.size !== 12) parts.push('in ' + listOf(c.mon, 12, m => MON_LONG[m - 1]));
    if (parts.length) bits.push(parts.join(c.domR && c.dowR ? ' OR ' : ' '));
    else bits.push('every day');

    return bits.join(', ') + '.';
  }

  const pad = n => String(n).padStart(2, '0');
  const wallStr = w => w.y + '-' + pad(w.mo) + '-' + pad(w.d) + ' ' + pad(w.h) + ':' + pad(w.mi);

  /* --------------------------------------------------------------- audit */
  function auditJob(c, tz, now, trans) {
    const warnings = [];
    if (c.reboot) return { warnings: [], fires: [] };

    const fires = nextFires(c, tz, now, 6, 1500);
    if (!fires.length)
      warnings.push({ sev: 'bad', msg: 'This expression never fires. Nothing in the next four years matches it — the classic cause is a day-of-month that does not exist in the chosen month, like the 30th of February.' });

    if (c.domR && c.dowR)
      warnings.push({ sev: 'warn', msg: 'Both day-of-month and day-of-week are restricted, so cron runs this when EITHER matches, not both. That is almost certainly more often than you intended.' });

    if (c.min.size === 60 && c.hour.size === 24)
      warnings.push({ sev: 'warn', msg: 'This runs every single minute — 1,440 times a day. If the job takes longer than a minute, runs will overlap unless you use a lock.' });

    if (c.seconds)
      warnings.push({ sev: 'warn', msg: 'Six fields were given, so this was read as a Spring or Quartz expression with a leading seconds field. On a normal Linux crontab this line would be rejected.' });

    /* DST */
    trans.forEach(tr => {
      const p = partsIn(new Date(tr.at.getTime() - 60000), tz);
      if (tr.delta > 0) {
        /* Spring forward: wall times in the gap never happen. */
        const gapStart = tr.before, gapMinutes = tr.delta;
        const base = new Date(tr.at.getTime() - 60000);
        const bp = partsIn(base, tz);
        for (let k = 0; k < gapMinutes; k++) {
          const total = (bp.h * 60 + bp.mi + 1 + k);
          const h = Math.floor(total / 60) % 24, mi = total % 60;
          if (dayMatches(c, bp.y, bp.mo, bp.d) && c.hour.has(h) && c.min.has(mi)) {
            warnings.push({ sev: 'bad', msg: 'Skipped by daylight saving on ' + bp.y + '-' + pad(bp.mo) + '-' + pad(bp.d) +
              ': the clocks jump forward and ' + pad(h) + ':' + pad(mi) + ' never happens that day, so this run is silently lost.' });
            break;
          }
        }
      } else if (tr.delta < 0) {
        /* Fall back: the hour before the transition repeats. */
        const repeat = -tr.delta;
        const base = new Date(tr.at.getTime() - 60000);
        const bp = partsIn(base, tz);
        for (let k = 0; k < repeat; k++) {
          const total = (bp.h * 60 + bp.mi + 1 - repeat + k + 1440);
          const h = Math.floor(total / 60) % 24, mi = total % 60;
          if (dayMatches(c, bp.y, bp.mo, bp.d) && c.hour.has(h) && c.min.has(mi)) {
            warnings.push({ sev: 'warn', msg: 'Ambiguous on ' + bp.y + '-' + pad(bp.mo) + '-' + pad(bp.d) +
              ': the clocks go back, so ' + pad(h) + ':' + pad(mi) + ' happens twice. Depending on the cron implementation this run happens twice or at an unexpected offset.' });
            break;
          }
        }
      }
    });

    return { warnings: warnings, fires: fires };
  }

  /* -------------------------------------------------- window of all fires */
  const MAX_FIRES_PER_JOB = 20000;

  /* One pass over the horizon per job; collisions and the heatmap share it. */
  function firesInWindow(jobs, tz, now, days) {
    const horizon = new Date(now.getTime() + days * 86400000);
    const start = partsIn(now, tz);
    return jobs.map(j => {
      if (!j.cron || j.cron.reboot) return [];
      const list = [];
      for (const w of wallMatches(j.cron, start, days + 2)) {
        const dt = wallToUTC(w.y, w.mo, w.d, w.h, w.mi, tz);
        if (dt === null) continue;                    /* skipped by DST */
        if (dt > horizon) break;
        if (dt < now) continue;
        list.push({ w: w, dt: dt });
        if (list.length >= MAX_FIRES_PER_JOB) break;
      }
      return list;
    });
  }

  function collisionsOf(jobs, tz, now, days, fires) {
    const all = fires || firesInWindow(jobs, tz, now, days);
    const buckets = new Map();
    all.forEach((list, idx) => {
      list.forEach(f => {
        const key = wallStr(f.w);
        if (!buckets.has(key)) buckets.set(key, new Set());
        buckets.get(key).add(idx);
      });
    });
    const out = [];
    buckets.forEach((set, key) => {
      if (set.size > 1) out.push({ when: key, jobs: [...set] });
    });
    out.sort((a, b) => (b.jobs.length - a.jobs.length) || a.when.localeCompare(b.when));
    return out;
  }

  function heatmap(now, days, fires) {
    const grid = [];
    for (let d = 0; d < days; d++) grid.push(new Array(24).fill(0));
    fires.forEach(list => list.forEach(f => {
      const dayIdx = Math.floor((f.dt - now) / 86400000);
      if (dayIdx >= 0 && dayIdx < days) grid[dayIdx][f.w.h]++;
    }));
    return grid;
  }

  /* Exposed for tests. */
  window.PapercutsCron = { parseCron, describe, nextFires, dayMatches, wallToUTC,
    transitions, collisionsOf, firesInWindow, heatmap, offsetMinutes, partsIn, wallStr };

  /* -------------------------------------------------------------- render */
  if (!document.getElementById('input')) return;

  const statusEl = $('#status'), outEl = $('#out');

  /* timezone picker */
  const tzSel = $('#tz');
  const localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let zones;
  try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = null; }
  if (!zones || !zones.length) {
    zones = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Moscow', 'Asia/Dubai',
      'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
  }
  if (zones.indexOf(localTZ) < 0) zones.unshift(localTZ);
  if (zones.indexOf('UTC') < 0) zones.unshift('UTC');
  tzSel.innerHTML = zones.map(z =>
    '<option value="' + esc(z) + '"' + (z === localTZ ? ' selected' : '') + '>' + esc(z) +
    (z === localTZ ? ' (yours)' : '') + '</option>').join('');

  function parseLines(text) {
    const jobs = [];
    text.split('\n').forEach((line, i) => {
      const raw = line.trim();
      if (!raw || raw.startsWith('#')) return;
      /* Strip an env assignment line like PATH=/usr/bin */
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(raw) && !/^\S+\s+\S+\s+\S+\s+\S+\s+\S+/.test(raw)) return;
      let expr = raw, command = '';
      if (raw.startsWith('@')) {
        const m = /^(@\w+)\s*(.*)$/.exec(raw);
        expr = m[1]; command = m[2] || '';
      } else {
        const f = raw.split(/\s+/);
        const take = f.length >= 6 && /^[\d*,\-/?]+$/.test(f[5]) ? 6 : 5;
        expr = f.slice(0, take).join(' ');
        command = f.slice(take).join(' ');
      }
      let cron = null, error = null;
      try { cron = parseCron(expr); } catch (e) { error = e.message; }
      jobs.push({ line: i + 1, expr: expr, command: command, cron: cron, error: error });
    });
    return jobs;
  }

  function run() {
    const text = $('#input').value;
    const tz = tzSel.value;
    const jobs = parseLines(text);
    if (!jobs.length) {
      statusEl.innerHTML = '<section><div class="err">No cron lines found. Add at least one expression.</div></section>';
      outEl.hidden = true; return;
    }
    if (jobs.length > 300) {
      statusEl.innerHTML = '<section><div class="err">That is over 300 lines. Try a smaller crontab.</div></section>';
      return;
    }
    statusEl.innerHTML = '';
    const now = new Date();
    const trans = transitions(tz, now, new Date(now.getTime() + 400 * 86400000));
    jobs.forEach(j => {
      if (!j.cron) { j.audit = { warnings: [], fires: [] }; return; }
      j.audit = auditJob(j.cron, tz, now, trans);
    });
    render(jobs, tz, now, trans);
  }

  function fmtFire(f, tz) {
    if (f.skipped) return '<span class="fire" style="color:var(--bad)">' + wallStr(f.wall) + ' — skipped (DST)</span>';
    const rel = relTime(f.date);
    return '<span class="fire">' + wallStr(f.wall) + ' <span class="muted">' + rel + '</span></span>';
  }

  function relTime(d) {
    const s = Math.round((d - Date.now()) / 1000);
    if (s < 60) return 'in <1 min';
    if (s < 3600) return 'in ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'in ' + Math.round(s / 3600) + ' h';
    return 'in ' + Math.round(s / 86400) + ' d';
  }

  function render(jobs, tz, now, trans) {
    const valid = jobs.filter(j => j.cron && !j.cron.reboot);
    const fires = firesInWindow(valid, tz, now, 7);
    const cols = collisionsOf(valid, tz, now, 7, fires);
    const grid = heatmap(now, 7, fires);
    const bad = jobs.filter(j => j.error || (j.audit.warnings || []).some(w => w.sev === 'bad')).length;
    const warn = jobs.filter(j => !j.error && (j.audit.warnings || []).some(w => w.sev === 'warn') &&
      !(j.audit.warnings || []).some(w => w.sev === 'bad')).length;
    const h = [];

    h.push('<section><div class="card pad" style="border-color:' +
      (bad ? 'var(--bad)' : (warn || cols.length) ? 'var(--warn)' : 'var(--ok)') + '">');
    h.push('<h2 style="margin:0;font-size:19px">' +
      (bad ? fmt(bad) + ' line' + (bad === 1 ? '' : 's') + ' will not do what you think'
        : cols.length ? fmt(cols.length) + ' minute' + (cols.length === 1 ? '' : 's') + ' where jobs pile up'
        : warn ? fmt(warn) + ' line' + (warn === 1 ? '' : 's') + ' worth a look'
        : jobs.length === 1 ? 'That line looks sane'
        : 'All ' + fmt(jobs.length) + ' lines look sane') + '</h2>');
    h.push('<div class="muted" style="margin-top:4px">' + fmt(jobs.length) + ' cron line' +
      (jobs.length === 1 ? '' : 's') + ' &middot; timezone <code>' + esc(tz) + '</code> &middot; ' +
      trans.length + ' daylight-saving transition' + (trans.length === 1 ? '' : 's') + ' in the next year</div></div></section>');

    h.push('<section><div class="stats">');
    h.push('<div class="stat ' + (bad ? 'bad' : 'ok') + '"><b>' + fmt(bad) + '</b><span>broken</span></div>');
    h.push('<div class="stat ' + (warn ? 'warn' : 'ok') + '"><b>' + fmt(warn) + '</b><span>risky</span></div>');
    h.push('<div class="stat ' + (cols.length ? 'warn' : 'ok') + '"><b>' + fmt(cols.length) + '</b><span>collisions / 7d</span></div>');
    h.push('<div class="stat"><b>' + fmt(grid.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0)) + '</b><span>runs / 7d</span></div>');
    h.push('</div></section>');

    /* collisions */
    if (cols.length) {
      h.push('<section><h2 style="font-size:17px;margin:0 0 9px">Jobs landing on the same minute</h2>');
      h.push('<div class="tablewrap" style="max-height:320px;overflow:auto"><table><thead><tr>' +
        '<th>When (' + esc(tz) + ')</th><th>How many</th><th>Which lines</th></tr></thead><tbody>');
      cols.slice(0, 60).forEach(c => {
        h.push('<tr><td class="mono">' + esc(c.when) + '</td><td>' + c.jobs.length + '</td><td class="mono">' +
          c.jobs.map(i => 'line ' + valid[i].line + ' <span class="muted">' + esc(valid[i].expr) + '</span>').join('<br>') +
          '</td></tr>');
      });
      h.push('</tbody></table></div>');
      if (cols.length > 60) h.push('<p class="muted" style="margin:8px 0 0">Showing the first 60 of ' + fmt(cols.length) + '.</p>');
      h.push('<p class="muted" style="margin:8px 0 0">Stagger these by a few minutes, or add a lock, unless they are genuinely independent.</p></section>');
    }

    /* heatmap */
    const max = Math.max(1, ...grid.map(r => Math.max(...r)));
    h.push('<section><h2 style="font-size:17px;margin:0 0 9px">Next 7 days, by hour</h2><div class="card pad"><div class="heat">');
    h.push('<span></span>');
    for (let hh = 0; hh < 24; hh++) h.push('<span class="hh">' + (hh % 3 === 0 ? hh : '') + '</span>');
    grid.forEach((row, d) => {
      const day = new Date(now.getTime() + d * 86400000);
      h.push('<span class="hl">' + day.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz }) + '</span>');
      row.forEach(v => {
        const a = v ? (0.22 + 0.78 * Math.min(1, v / max)) : 0;
        h.push('<i title="' + v + ' run' + (v === 1 ? '' : 's') + '"' +
          (v ? ' style="background:color-mix(in srgb, var(--accent) ' + Math.round(a * 100) +
            '%, transparent);border-color:transparent"' : '') + '></i>');
      });
    });
    h.push('</div><p class="muted" style="margin:10px 0 0">Darker means more runs starting in that hour. Hover for the count.</p></div></section>');

    /* per job */
    h.push('<section><h2 style="font-size:17px;margin:0 0 11px">Line by line</h2>');
    jobs.forEach(j => {
      const ws = j.audit ? j.audit.warnings : [];
      const cls = j.error || ws.some(w => w.sev === 'bad') ? 'bad' : ws.length ? 'warn' : 'ok';
      h.push('<div class="job ' + cls + '">');
      h.push('<h3>' + esc(j.expr) + (j.command ? ' <span class="muted" style="font-weight:400">' +
        esc(j.command.slice(0, 60)) + (j.command.length > 60 ? '…' : '') + '</span>' : '') + '</h3>');
      if (j.error) {
        h.push('<div class="muted" style="color:var(--bad)">Line ' + j.line + ': ' + esc(j.error) + '</div>');
      } else {
        h.push('<div class="muted">' + esc(describe(j.cron)) + '</div>');
        ws.forEach(w => h.push('<div style="margin-top:6px"><span class="badge ' +
          (w.sev === 'bad' ? 'bad' : 'warn') + '">' + (w.sev === 'bad' ? 'breaks' : 'watch') +
          '</span> <span class="muted">' + esc(w.msg) + '</span></div>'));
        if (j.audit.fires.length) {
          h.push('<div class="fires">' + j.audit.fires.map(f => fmtFire(f, tz)).join('') + '</div>');
        }
      }
      h.push('</div>');
    });
    h.push('</section>');

    h.push('<section><div class="row"><button id="cp-report">Copy report</button>' +
      '<button id="reset">Start over</button></div></section>');

    outEl.innerHTML = h.join('');
    outEl.hidden = false;

    $('#cp-report').onclick = () => copy(report(jobs, cols, valid, tz), 'Report copied');
    $('#reset').onclick = () => {
      outEl.hidden = true; outEl.innerHTML = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    outEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function report(jobs, cols, valid, tz) {
    const L = ['Crontab review — timezone ' + tz, ''];
    jobs.forEach(j => {
      L.push(j.expr + (j.command ? '   ' + j.command : ''));
      if (j.error) { L.push('  ERROR: ' + j.error); L.push(''); return; }
      L.push('  ' + describe(j.cron));
      (j.audit.warnings || []).forEach(w => L.push('  [' + w.sev.toUpperCase() + '] ' + w.msg));
      L.push('');
    });
    if (cols.length) {
      L.push('Collisions in the next 7 days:');
      cols.slice(0, 30).forEach(c =>
        L.push('  ' + c.when + ' — ' + c.jobs.length + ' jobs: ' + c.jobs.map(i => valid[i].expr).join(' | ')));
      L.push('');
    }
    L.push('(Checked with https://papercuts.tools/cron-inspector)');
    return L.join('\n');
  }

  /* ------------------------------------------------------------ handlers */
  $('#run').onclick = run;
  tzSel.onchange = () => { if (!outEl.hidden) run(); };
  $('#clear').onclick = () => {
    $('#input').value = ''; outEl.hidden = true; outEl.innerHTML = '';
    statusEl.innerHTML = ''; $('#input').focus();
  };
  $('#input').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  const SAMPLE = [
    '# nightly maintenance',
    '0 3 * * *    /usr/local/bin/backup.sh',
    '0 3 * * *    /usr/local/bin/reindex.sh',
    '0 3 * * *    /usr/local/bin/rotate-logs.sh',
    '*/5 * * * *  /usr/local/bin/poll-queue.sh',
    '30 2 * * 0   /usr/local/bin/weekly-report.sh',
    '0 0 1 * MON  /usr/local/bin/invoice-run.sh',
    '0 0 30 2 *   /usr/local/bin/never-runs.sh',
    '@daily       /usr/local/bin/cleanup.sh',
    '15 2 * * *   /usr/local/bin/dst-victim.sh'
  ].join('\n');

  $('#sample').onclick = () => { $('#input').value = SAMPLE; run(); };
})();
