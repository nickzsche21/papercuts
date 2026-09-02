/* Single source of truth for what ships.
   build.mjs and scripts/preflight.mjs both read this, so a tool cannot be
   half-registered — added to the build but missing from the hub, or vice versa. */
export const PAGES = [
  '.', 'cors', 'csp', 'paste-damage', 'cache-control', 'gitignore', 'regex-flavours',
  'csv-diff', 'csv-excel-guard', 'invisible-characters', 'json-to-csv',
  'filename-checker', 'cron-inspector'
];

/* Test suites, by their test/test-<name>.mjs suffix. */
export const SUITES = [
  'csv', 'xray', 'json', 'names', 'cron', 'cors',
  'csp', 'cache', 'gitignore', 'regex', 'csvdiff', 'paste'
];

export const SITE = 'https://papercuts-mauve.vercel.app';

/* Tool directories only — the hub page is not a tool. */
export const TOOLS = PAGES.filter(p => p !== '.');
