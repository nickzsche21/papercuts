/* CORS Error Decoder — 100% client-side. */
(function () {
  'use strict';
  const { $, esc, toast, copy, fmt } = window.PC;

  /* ------------------------------------------------------------ extraction */
  function extract(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    const g = (re, i) => { const m = re.exec(t); return m ? m[i || 1] : null; };

    const origin = g(/from origin ['"]([^'"]+)['"]/i)
      || g(/\bOrigin\s+(https?:\/\/[^\s,]+?)\s+is not allowed/i)
      || g(/^Origin\s+(https?:\/\/\S+)/i);

    let target = g(/Access to (?:fetch|XMLHttpRequest|resource|script|image|font|manifest|video|audio)(?: at)? ['"]([^'"]+)['"]/i)
      || g(/remote resource at (\S+?)[.\s]*(?:\(|$)/i)
      || g(/cannot load (\S+?)[.\s]*(?:due|$)/i);
    if (target) target = target.replace(/[.,)]+$/, '');

    const browser = /has been blocked by CORS policy/i.test(t) ? 'Chrome or Edge'
      : /Cross-Origin Request Blocked|\(Reason:/i.test(t) ? 'Firefox'
      : /due to access control checks|Preflight response is not successful/i.test(t) ? 'Safari'
      : null;

    const preflight = /preflight/i.test(t);
    const status = g(/Status code:\s*(\d{3})/i);

    return { text: t, origin, target, browser, preflight, status: status ? +status : null };
  }

  const originOf = url => { try { const u = new URL(url); return u.origin; } catch (e) { return null; } };

  /* ----------------------------------------------------------------- rules */
  /* Ordered most-specific first. `need` drives the config generator. */
  const RULES = [
    {
      id: 'network',
      match: [/CORS request did not succeed/i, /Failed to fetch(?!.*blocked by CORS)/i,
              /NetworkError when attempting to fetch/i],
      title: 'The server never answered — this is probably not a CORS misconfiguration',
      blame: 'network',
      what: 'The browser could not complete the request at all, so there was no response for it to check CORS headers on. Firefox reports this with CORS wording, which is misleading. The usual causes are a server that is not running, the wrong port, a self-signed or expired TLS certificate, an http:// call from an https:// page, DNS failure, or a browser extension or ad blocker cancelling the request.',
      steps: [
        'Open the target URL directly in a new browser tab. If that fails or warns about the certificate, the problem is the server or TLS, not CORS.',
        'Check the Network tab: a genuine CORS block shows a response with headers. This shows a failed or cancelled request with no response at all.',
        'Retry with extensions disabled, and confirm the scheme matches — an https:// page cannot call an http:// endpoint.'
      ],
      need: null
    },
    {
      id: 'scheme',
      match: [/only supported for protocol schemes/i],
      title: 'The page is not on a real origin',
      blame: 'client',
      what: 'The page was opened from the filesystem (file://) or another scheme with no origin, so every request it makes counts as cross-origin from a null origin. No server configuration can allow this.',
      steps: [
        'Serve the page over http:// instead of opening the .html file directly.',
        'Any static server works: npx serve, python3 -m http.server, or your framework dev server.'
      ],
      need: null
    },
    {
      id: 'wildcard-credentials',
      match: [/must not be the wildcard ['"]?\*['"]?.*credentials/i,
              /Credential is not supported if the CORS header ['"]Access-Control-Allow-Origin['"] is ['"]\*['"]/i,
              /wildcard in Access-Control-Allow-Origin when the request's credentials mode is/i],
      title: 'The server sends a wildcard, but your request carries credentials',
      blame: 'server',
      what: 'Your request sets credentials (cookies, or an Authorization header via withCredentials). The spec forbids the wildcard in that case, because `*` plus credentials would let any site on the internet read authenticated responses. The server has to name your origin explicitly instead.',
      steps: [
        'Stop sending Access-Control-Allow-Origin: * and echo the caller’s exact origin back instead.',
        'Add Access-Control-Allow-Credentials: true.',
        'Add Vary: Origin, or a CDN will cache one origin’s header and serve it to everyone else.',
        'If you do not actually need cookies, the simpler fix is to drop credentials from the request and keep the wildcard.'
      ],
      need: { credentials: true, echo: true }
    },
    {
      id: 'credentials-not-true',
      match: [/['"]Access-Control-Allow-Credentials['"] header in the response is/i,
              /must be ['"]true['"] to allow credentials/i],
      title: 'Credentials were sent, but the server did not allow them',
      blame: 'server',
      what: 'Your request included credentials, and the server’s Access-Control-Allow-Credentials header is missing or is not exactly the string "true". The browser therefore discards the response.',
      steps: [
        'Add Access-Control-Allow-Credentials: true to the response — on the preflight as well as the real request.',
        'Make sure Access-Control-Allow-Origin names your exact origin, not *.',
        'Add Vary: Origin.'
      ],
      need: { credentials: true, echo: true }
    },
    {
      id: 'origin-mismatch',
      match: [/has a value ['"]([^'"]*)['"] that is not equal to the supplied origin/i,
              /does not match the supplied origin/i,
              /Access-Control-Allow-Origin['"]? does not match/i,
              /is not allowed by Access-Control-Allow-Origin/i],
      title: 'The server allows a different origin than the one you are calling from',
      blame: 'server',
      what: 'The server did send Access-Control-Allow-Origin, but its value is not your origin. Usually the allowlist is hardcoded to production and you are on localhost or a preview URL, or it includes a trailing slash. An origin is scheme + host + port and never has a path or a trailing slash.',
      steps: [
        'Add your origin to the server’s allowlist — exactly, with no trailing slash.',
        'Remember that http://localhost:3000 and http://127.0.0.1:3000 are different origins, as are http and https, and every port.',
        'Echo the matched origin back rather than returning a fixed one, and send Vary: Origin.'
      ],
      need: { echo: true }
    },
    {
      id: 'multiple-values',
      match: [/contains multiple values/i, /Access-Control-Allow-Origin.*multiple/i],
      title: 'The header is being added twice',
      blame: 'server',
      what: 'Two layers are each adding Access-Control-Allow-Origin — typically your application framework and your reverse proxy, or a CORS library plus a hand-written middleware. The browser rejects a duplicated header outright, even when both copies say the same thing.',
      steps: [
        'Pick one layer to own CORS and remove the header from the other.',
        'In nginx, remember that add_header inside an if block replaces the outer ones rather than adding to them.',
        'Check for a CORS library and a manual middleware both being registered in the app.'
      ],
      need: { echo: true }
    },
    {
      id: 'header-not-allowed',
      match: [/Request header field ([\w-]+) is not allowed by Access-Control-Allow-Headers/i,
              /header ['"]([\w-]+)['"] is not allowed according to header ['"]Access-Control-Allow-Headers['"]/i],
      capture: 'header',
      title: 'A request header was not on the preflight allowlist',
      blame: 'server',
      what: 'Your request sends a header the server did not list in Access-Control-Allow-Headers on the preflight response. Adding a custom header is also what forced the preflight to happen in the first place — Authorization and Content-Type: application/json are the two usual causes.',
      steps: [
        'Add the named header to Access-Control-Allow-Headers on the OPTIONS response.',
        'The list must be complete; the browser does not merge it with defaults.',
        'Header names are case-insensitive, but the header must be present on the preflight response, not just the real one.'
      ],
      need: { headersFromError: true }
    },
    {
      id: 'method-not-allowed',
      match: [/Method ([A-Z]+) is not allowed by Access-Control-Allow-Methods/i,
              /Did not find method in CORS header ['"]Access-Control-Allow-Methods['"]/i],
      capture: 'method',
      title: 'The HTTP method was not on the preflight allowlist',
      blame: 'server',
      what: 'The preflight response did not list your method in Access-Control-Allow-Methods. Only GET, HEAD and POST are allowed by default; PUT, PATCH and DELETE all have to be named explicitly.',
      steps: [
        'Add the method to Access-Control-Allow-Methods on the OPTIONS response.',
        'Include OPTIONS itself in the list.',
        'Make sure the route actually accepts OPTIONS — many routers 404 it otherwise.'
      ],
      need: { methodFromError: true }
    },
    {
      id: 'preflight-redirect',
      match: [/Redirect is not allowed for a preflight/i],
      title: 'The preflight got redirected',
      blame: 'server',
      what: 'The OPTIONS request received a 3xx redirect. Preflights are not allowed to follow redirects at all, so the browser stops immediately. This is nearly always a redirect you forgot about: http to https, adding or removing a trailing slash, or a www canonicalisation.',
      steps: [
        'Call the final URL directly — use https, and match the trailing slash the server expects.',
        'Exempt OPTIONS from your redirect rules, or place the CORS handler before them.',
        'Check for a framework APPEND_SLASH setting rewriting /api/thing to /api/thing/.'
      ],
      need: { preflight: true }
    },
    {
      id: 'preflight-not-ok',
      match: [/It does not have HTTP ok status/i, /Preflight response is not successful/i,
              /CORS preflight channel did not succeed/i, /Response for preflight has invalid HTTP status/i],
      title: 'The preflight itself failed',
      blame: 'server',
      what: 'The OPTIONS preflight did not return a 2xx. This is the classic middleware-ordering bug: a preflight carries no cookies and no Authorization header, so authentication middleware sees an anonymous request and returns 401 or 403 before the CORS layer ever runs. A 404 means the route does not accept OPTIONS at all.',
      steps: [
        'Register the CORS middleware before authentication, and before any router that could 404.',
        'Make OPTIONS on that path return 204 with no body and no auth requirement.',
        'Check the status of the OPTIONS request in the Network tab — 401 or 403 means auth ordering, 404 means routing, 500 means the handler threw.'
      ],
      need: { preflight: true }
    },
    {
      id: 'preflight-no-acao',
      match: [/preflight[\s\S]*No ['"]Access-Control-Allow-Origin['"] header is present/i],
      title: 'The preflight response has no CORS headers',
      blame: 'server',
      what: 'The OPTIONS preflight returned successfully but carried no Access-Control-Allow-Origin header. Usually the CORS layer only decorates real responses, and OPTIONS is being handled somewhere earlier — by the framework’s default handler or by a proxy.',
      steps: [
        'Make sure the same CORS layer handles OPTIONS, not just GET and POST.',
        'If a reverse proxy answers OPTIONS itself, add the headers there instead.',
        'Confirm the headers appear on the OPTIONS response in the Network tab, not only on the real request.'
      ],
      need: { preflight: true }
    },
    {
      id: 'expose-headers',
      match: [/Access-Control-Expose-Headers/i, /Refused to get unsafe header/i],
      title: 'The response arrived, but you cannot read that header',
      blame: 'server',
      what: 'The request itself succeeded. JavaScript can only read six response headers by default — Cache-Control, Content-Language, Content-Length, Content-Type, Expires, Last-Modified and Pragma. Anything else, including X-Total-Count, Location or a pagination header, has to be named in Access-Control-Expose-Headers.',
      steps: [
        'Add Access-Control-Expose-Headers listing the headers you want to read.',
        'This goes on the real response, not the preflight.'
      ],
      need: { expose: true }
    },
    {
      id: 'private-network',
      match: [/[Pp]rivate [Nn]etwork/i, /request client is not a secure context/i],
      title: 'A public page is calling a private network address',
      blame: 'server',
      what: 'Chrome’s Private Network Access rules block a public website from calling localhost or a LAN address unless the target opts in. The device or local server has to answer the preflight with Access-Control-Allow-Private-Network: true, and the calling page generally has to be a secure context.',
      steps: [
        'Add Access-Control-Allow-Private-Network: true to the OPTIONS response on the local device.',
        'Serve the calling page over https, or use http://localhost, which counts as a secure context.'
      ],
      need: { privateNetwork: true, preflight: true }
    },
    {
      id: 'redirect-blocked',
      match: [/Redirect has been blocked/i],
      title: 'The request was redirected somewhere without CORS headers',
      blame: 'server',
      what: 'The request was redirected, and the destination did not send CORS headers. Every hop in a redirect chain has to be CORS-enabled, and after a cross-origin redirect the origin becomes null, so an allowlist that names your origin will no longer match.',
      steps: [
        'Call the final URL directly and skip the redirect.',
        'If the redirect is unavoidable, make every hop send CORS headers.',
        'Watch for http-to-https and trailing-slash redirects, which are easy to miss.'
      ],
      need: { echo: true }
    },
    {
      id: 'no-acao',
      match: [/No ['"]Access-Control-Allow-Origin['"] header is present/i,
              /CORS header ['"]Access-Control-Allow-Origin['"] missing/i,
              /has been blocked by CORS policy/i],
      title: 'The server sent no CORS headers at all',
      blame: 'server',
      what: 'The request reached the server and the server answered, but the response carried no Access-Control-Allow-Origin header, so the browser refused to hand it to your JavaScript. This is the default state of every server that has never been configured for CORS — nothing is broken, the opt-in has simply not been made.',
      steps: [
        'Add Access-Control-Allow-Origin to the responses from the API, naming your origin.',
        'If the request sends JSON or an Authorization header it is preflighted, so OPTIONS needs the headers too.',
        'If you do not control that server, your options are a proxy on your own origin or the vendor’s CORS settings — nothing on the calling page can fix it.'
      ],
      need: { echo: true }
    }
  ];

  function diagnose(text) {
    const info = extract(text);
    for (const r of RULES) {
      for (const re of r.match) {
        const m = re.exec(info.text);
        if (m) {
          const hit = { rule: r, info: info };
          if (r.capture === 'header' && m[1]) hit.header = m[1];
          if (r.capture === 'method' && m[1]) hit.method = m[1];
          if (r.id === 'origin-mismatch' && m[1]) hit.serverSays = m[1];
          return hit;
        }
      }
    }
    return null;
  }

  /* --------------------------------------------------------- request shape */
  const SAFELISTED = ['accept', 'accept-language', 'content-language', 'content-type',
    'range', 'attribution-reporting-eligible'];
  const SIMPLE_CT = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

  function preflightNeeded(shape) {
    const reasons = [];
    if (['GET', 'HEAD', 'POST'].indexOf(shape.method) < 0)
      reasons.push('the method is ' + shape.method + ', and only GET, HEAD and POST avoid a preflight');
    const ct = (shape.contentType || '').toLowerCase().split(';')[0].trim();
    if (ct && SIMPLE_CT.indexOf(ct) < 0)
      reasons.push('Content-Type is ' + ct + ', and only the three form/text types avoid a preflight');
    const custom = (shape.headers || []).map(h => h.toLowerCase().trim()).filter(Boolean)
      .filter(h => SAFELISTED.indexOf(h) < 0);
    if (custom.length)
      reasons.push('the request sends ' + custom.join(', ') + ', which is not on the CORS safelist');
    return { preflight: reasons.length > 0, reasons: reasons, custom: custom };
  }

  /* ---------------------------------------------------------- config gen */
  const STACKS = [
    'nginx', 'Apache', 'Express', 'Next.js', 'Flask', 'Django',
    'FastAPI', 'Spring Boot', 'ASP.NET Core', 'Go', 'Rails', 'Caddy', 'Cloudflare', 'S3 + CloudFront'
  ];

  function gen(stack, c) {
    const o = c.origin || 'https://your-app.example.com';
    const methods = c.methods.join(', ');
    const headers = c.headers.join(', ');
    const cred = c.credentials;
    const L = [];
    const note = s => '# ' + s;

    switch (stack) {
      case 'nginx':
        L.push('# nginx: add_header inside an if{} REPLACES the outer ones,');
        L.push('# so the preflight block repeats every header it needs.');
        L.push('');
        L.push('map $http_origin $cors_origin {');
        L.push('    default          "";');
        L.push('    "' + o + '"  $http_origin;');
        L.push('}');
        L.push('');
        L.push('server {');
        L.push('    location /api/ {');
        L.push('        if ($request_method = OPTIONS) {');
        L.push('            add_header Access-Control-Allow-Origin  $cors_origin always;');
        L.push('            add_header Access-Control-Allow-Methods "' + methods + '" always;');
        L.push('            add_header Access-Control-Allow-Headers "' + headers + '" always;');
        if (cred) L.push('            add_header Access-Control-Allow-Credentials true always;');
        if (c.privateNetwork) L.push('            add_header Access-Control-Allow-Private-Network true always;');
        L.push('            add_header Access-Control-Max-Age     86400 always;');
        L.push('            add_header Vary                       Origin always;');
        L.push('            add_header Content-Length             0;');
        L.push('            return 204;');
        L.push('        }');
        L.push('');
        L.push('        add_header Access-Control-Allow-Origin  $cors_origin always;');
        if (cred) L.push('        add_header Access-Control-Allow-Credentials true always;');
        if (c.expose.length) L.push('        add_header Access-Control-Expose-Headers "' + c.expose.join(', ') + '" always;');
        L.push('        add_header Vary                       Origin always;');
        L.push('');
        L.push('        proxy_pass http://your_upstream;');
        L.push('    }');
        L.push('}');
        break;

      case 'Apache':
        L.push('# Requires mod_headers and mod_rewrite.');
        L.push('<IfModule mod_headers.c>');
        L.push('  SetEnvIf Origin "^' + o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$" CORS_ORIGIN=$0');
        L.push('  Header always set Access-Control-Allow-Origin  %{CORS_ORIGIN}e env=CORS_ORIGIN');
        L.push('  Header always set Access-Control-Allow-Methods "' + methods + '"');
        L.push('  Header always set Access-Control-Allow-Headers "' + headers + '"');
        if (cred) L.push('  Header always set Access-Control-Allow-Credentials "true"');
        if (c.expose.length) L.push('  Header always set Access-Control-Expose-Headers "' + c.expose.join(', ') + '"');
        L.push('  Header always set Access-Control-Max-Age "86400"');
        L.push('  Header always append Vary Origin');
        L.push('</IfModule>');
        L.push('');
        L.push('# Answer the preflight without touching the application.');
        L.push('RewriteEngine On');
        L.push('RewriteCond %{REQUEST_METHOD} OPTIONS');
        L.push('RewriteRule ^(.*)$ $1 [R=204,L]');
        break;

      case 'Express':
        L.push("const cors = require('cors');");
        L.push('');
        L.push('app.use(cors({');
        L.push("  origin: '" + o + "',");
        if (cred) L.push('  credentials: true,');
        L.push('  methods: [' + c.methods.map(m => "'" + m + "'").join(', ') + '],');
        L.push('  allowedHeaders: [' + c.headers.map(h => "'" + h + "'").join(', ') + '],');
        if (c.expose.length) L.push('  exposedHeaders: [' + c.expose.map(h => "'" + h + "'").join(', ') + '],');
        L.push('  maxAge: 86400,');
        L.push('}));');
        L.push('');
        L.push('// The cors() middleware answers OPTIONS by itself.');
        L.push('// Mount it ABOVE any auth middleware and above your routers,');
        L.push('// or the preflight gets a 401 before CORS ever runs.');
        break;

      case 'Next.js':
        L.push('// middleware.ts  — covers route handlers and API routes.');
        L.push("import { NextResponse } from 'next/server';");
        L.push("import type { NextRequest } from 'next/server';");
        L.push('');
        L.push("const ALLOWED = '" + o + "';");
        L.push('');
        L.push('export function middleware(req: NextRequest) {');
        L.push("  const origin = req.headers.get('origin');");
        L.push('  const cors = new Headers();');
        L.push("  if (origin === ALLOWED) cors.set('Access-Control-Allow-Origin', origin);");
        L.push("  cors.set('Access-Control-Allow-Methods', '" + methods + "');");
        L.push("  cors.set('Access-Control-Allow-Headers', '" + headers + "');");
        if (cred) L.push("  cors.set('Access-Control-Allow-Credentials', 'true');");
        if (c.expose.length) L.push("  cors.set('Access-Control-Expose-Headers', '" + c.expose.join(', ') + "');");
        L.push("  cors.set('Vary', 'Origin');");
        L.push('');
        L.push("  if (req.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers: cors });");
        L.push('');
        L.push('  const res = NextResponse.next();');
        L.push('  cors.forEach((v, k) => res.headers.set(k, v));');
        L.push('  return res;');
        L.push('}');
        L.push('');
        L.push("export const config = { matcher: '/api/:path*' };");
        break;

      case 'Flask':
        L.push('from flask_cors import CORS   # pip install flask-cors');
        L.push('');
        L.push('CORS(');
        L.push('    app,');
        L.push('    resources={r"/api/*": {"origins": ["' + o + '"]}},');
        if (cred) L.push('    supports_credentials=True,');
        L.push('    methods=[' + c.methods.map(m => '"' + m + '"').join(', ') + '],');
        L.push('    allow_headers=[' + c.headers.map(h => '"' + h + '"').join(', ') + '],');
        if (c.expose.length) L.push('    expose_headers=[' + c.expose.map(h => '"' + h + '"').join(', ') + '],');
        L.push('    max_age=86400,');
        L.push(')');
        L.push('');
        L.push('# flask-cors answers OPTIONS itself. If you use a @before_request');
        L.push('# auth check, exempt OPTIONS from it or the preflight gets a 401.');
        break;

      case 'Django':
        L.push('# pip install django-cors-headers');
        L.push('');
        L.push('INSTALLED_APPS = [');
        L.push('    "corsheaders",');
        L.push('    ...');
        L.push(']');
        L.push('');
        L.push('MIDDLEWARE = [');
        L.push('    "corsheaders.middleware.CorsMiddleware",   # must be as high as possible,');
        L.push('    "django.middleware.common.CommonMiddleware",  # and above CommonMiddleware');
        L.push('    ...');
        L.push(']');
        L.push('');
        L.push('CORS_ALLOWED_ORIGINS = ["' + o + '"]');
        if (cred) L.push('CORS_ALLOW_CREDENTIALS = True');
        L.push('CORS_ALLOW_METHODS = [' + c.methods.map(m => '"' + m + '"').join(', ') + ']');
        L.push('CORS_ALLOW_HEADERS = [' + c.headers.map(h => '"' + h.toLowerCase() + '"').join(', ') + ']');
        if (c.expose.length) L.push('CORS_EXPOSE_HEADERS = [' + c.expose.map(h => '"' + h + '"').join(', ') + ']');
        L.push('');
        L.push('# APPEND_SLASH redirects /api/x to /api/x/ — a redirect kills a preflight,');
        L.push('# so call the URL with the slash the server expects.');
        break;

      case 'FastAPI':
        L.push('from fastapi.middleware.cors import CORSMiddleware');
        L.push('');
        L.push('app.add_middleware(');
        L.push('    CORSMiddleware,');
        L.push('    allow_origins=["' + o + '"],');
        if (cred) L.push('    allow_credentials=True,');
        L.push('    allow_methods=[' + c.methods.map(m => '"' + m + '"').join(', ') + '],');
        L.push('    allow_headers=[' + c.headers.map(h => '"' + h + '"').join(', ') + '],');
        if (c.expose.length) L.push('    expose_headers=[' + c.expose.map(h => '"' + h + '"').join(', ') + '],');
        L.push('    max_age=86400,');
        L.push(')');
        L.push('');
        L.push('# allow_origins=["*"] together with allow_credentials=True is silently');
        L.push('# downgraded by Starlette and will not work. Name the origin.');
        break;

      case 'Spring Boot':
        L.push('@Configuration');
        L.push('public class CorsConfig implements WebMvcConfigurer {');
        L.push('    @Override');
        L.push('    public void addCorsMappings(CorsRegistry registry) {');
        L.push('        registry.addMapping("/api/**")');
        L.push('            .allowedOrigins("' + o + '")');
        L.push('            .allowedMethods(' + c.methods.map(m => '"' + m + '"').join(', ') + ')');
        L.push('            .allowedHeaders(' + c.headers.map(h => '"' + h + '"').join(', ') + ')');
        if (c.expose.length) L.push('            .exposedHeaders(' + c.expose.map(h => '"' + h + '"').join(', ') + ')');
        if (cred) L.push('            .allowCredentials(true)');
        L.push('            .maxAge(86400);');
        L.push('    }');
        L.push('}');
        L.push('');
        L.push('// With Spring Security, ALSO enable it on the security chain or the');
        L.push('// filter rejects the preflight before MVC sees it:');
        L.push('//   http.cors(Customizer.withDefaults())');
        L.push('//       .authorizeHttpRequests(a -> a');
        L.push('//           .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll());');
        break;

      case 'ASP.NET Core':
        L.push('builder.Services.AddCors(options =>');
        L.push('{');
        L.push('    options.AddPolicy("app", policy =>');
        L.push('        policy.WithOrigins("' + o + '")');
        L.push('              .WithMethods(' + c.methods.map(m => '"' + m + '"').join(', ') + ')');
        L.push('              .WithHeaders(' + c.headers.map(h => '"' + h + '"').join(', ') + ')');
        if (c.expose.length) L.push('              .WithExposedHeaders(' + c.expose.map(h => '"' + h + '"').join(', ') + ')');
        if (cred) L.push('              .AllowCredentials()');
        L.push('    );');
        L.push('});');
        L.push('');
        L.push('// Order matters. UseCors must come after UseRouting and');
        L.push('// BEFORE UseAuthentication / UseAuthorization.');
        L.push('app.UseRouting();');
        L.push('app.UseCors("app");');
        L.push('app.UseAuthentication();');
        L.push('app.UseAuthorization();');
        break;

      case 'Go':
        L.push('func cors(next http.Handler) http.Handler {');
        L.push('    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {');
        L.push('        if r.Header.Get("Origin") == "' + o + '" {');
        L.push('            w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))');
        if (cred) L.push('            w.Header().Set("Access-Control-Allow-Credentials", "true")');
        L.push('        }');
        L.push('        w.Header().Add("Vary", "Origin")');
        if (c.expose.length) L.push('        w.Header().Set("Access-Control-Expose-Headers", "' + c.expose.join(', ') + '")');
        L.push('');
        L.push('        if r.Method == http.MethodOptions {');
        L.push('            w.Header().Set("Access-Control-Allow-Methods", "' + methods + '")');
        L.push('            w.Header().Set("Access-Control-Allow-Headers", "' + headers + '")');
        L.push('            w.Header().Set("Access-Control-Max-Age", "86400")');
        L.push('            w.WriteHeader(http.StatusNoContent)');
        L.push('            return');
        L.push('        }');
        L.push('        next.ServeHTTP(w, r)');
        L.push('    })');
        L.push('}');
        L.push('');
        L.push('// Wrap the outermost mux so the preflight never reaches auth:');
        L.push('//   http.ListenAndServe(":8080", cors(mux))');
        break;

      case 'Rails':
        L.push('# Gemfile:  gem "rack-cors"');
        L.push('# config/initializers/cors.rb');
        L.push('');
        L.push('Rails.application.config.middleware.insert_before 0, Rack::Cors do');
        L.push('  allow do');
        L.push('    origins "' + o + '"');
        L.push('    resource "/api/*",');
        L.push('      headers: :any,');
        L.push('      methods: [' + c.methods.map(m => ':' + m.toLowerCase()).join(', ') + '],');
        if (c.expose.length) L.push('      expose: [' + c.expose.map(h => '"' + h + '"').join(', ') + '],');
        if (cred) L.push('      credentials: true,');
        L.push('      max_age: 86400');
        L.push('  end');
        L.push('end');
        L.push('');
        L.push('# insert_before 0 puts it ahead of every other middleware,');
        L.push('# which is what keeps the preflight away from authentication.');
        break;

      case 'Caddy':
        L.push('your-api.example.com {');
        L.push('    @cors_preflight method OPTIONS');
        L.push('    @allowed_origin header Origin "' + o + '"');
        L.push('');
        L.push('    handle @cors_preflight {');
        L.push('        header {');
        L.push('            Access-Control-Allow-Origin  "' + o + '"');
        L.push('            Access-Control-Allow-Methods "' + methods + '"');
        L.push('            Access-Control-Allow-Headers "' + headers + '"');
        if (cred) L.push('            Access-Control-Allow-Credentials "true"');
        L.push('            Access-Control-Max-Age       "86400"');
        L.push('            Vary                         Origin');
        L.push('        }');
        L.push('        respond 204');
        L.push('    }');
        L.push('');
        L.push('    header @allowed_origin {');
        L.push('        Access-Control-Allow-Origin "' + o + '"');
        if (cred) L.push('        Access-Control-Allow-Credentials "true"');
        if (c.expose.length) L.push('        Access-Control-Expose-Headers "' + c.expose.join(', ') + '"');
        L.push('        Vary Origin');
        L.push('    }');
        L.push('');
        L.push('    reverse_proxy localhost:8080');
        L.push('}');
        break;

      case 'Cloudflare':
        L.push('// Cloudflare Worker');
        L.push("const ALLOWED = '" + o + "';");
        L.push('');
        L.push('function corsHeaders(origin) {');
        L.push('  const h = new Headers();');
        L.push("  if (origin === ALLOWED) h.set('Access-Control-Allow-Origin', origin);");
        L.push("  h.set('Access-Control-Allow-Methods', '" + methods + "');");
        L.push("  h.set('Access-Control-Allow-Headers', '" + headers + "');");
        if (cred) L.push("  h.set('Access-Control-Allow-Credentials', 'true');");
        if (c.expose.length) L.push("  h.set('Access-Control-Expose-Headers', '" + c.expose.join(', ') + "');");
        L.push("  h.set('Access-Control-Max-Age', '86400');");
        L.push("  h.set('Vary', 'Origin');");
        L.push('  return h;');
        L.push('}');
        L.push('');
        L.push('export default {');
        L.push('  async fetch(request) {');
        L.push("    const origin = request.headers.get('Origin');");
        L.push("    if (request.method === 'OPTIONS')");
        L.push('      return new Response(null, { status: 204, headers: corsHeaders(origin) });');
        L.push('');
        L.push('    const res = new Response((await fetch(request)).body, await fetch(request));');
        L.push('    corsHeaders(origin).forEach((v, k) => res.headers.set(k, v));');
        L.push('    return res;');
        L.push('  },');
        L.push('};');
        break;

      case 'S3 + CloudFront':
        L.push('// S3 bucket -> Permissions -> Cross-origin resource sharing (CORS)');
        L.push('[');
        L.push('  {');
        L.push('    "AllowedOrigins": ["' + o + '"],');
        L.push('    "AllowedMethods": [' + c.methods.filter(m => m !== 'OPTIONS' && m !== 'PATCH')
          .map(m => '"' + m + '"').join(', ') + '],');
        L.push('    "AllowedHeaders": ["*"],');
        L.push('    "ExposeHeaders": [' + (c.expose.length ? c.expose.map(h => '"' + h + '"').join(', ') : '"ETag"') + '],');
        L.push('    "MaxAgeSeconds": 86400');
        L.push('  }');
        L.push(']');
        L.push('');
        L.push('# If CloudFront sits in front, S3 CORS alone is not enough:');
        L.push('# the origin request policy must FORWARD the Origin,');
        L.push('# Access-Control-Request-Method and Access-Control-Request-Headers headers,');
        L.push('# and the cache policy must include Origin in the cache key.');
        L.push('# Otherwise CloudFront serves one origin’s cached response to everyone.');
        L.push('# This is the usual cause of a web font working for some users only.');
        break;
    }
    return L.join('\n');
  }

  /* Exposed for tests. */
  window.PapercutsCORS = { extract, diagnose, preflightNeeded, gen, STACKS, RULES, originOf };

  /* ---------------------------------------------------------------- render */
  if (!document.getElementById('input')) return;

  const statusEl = $('#status'), outEl = $('#out');
  let state = null;

  const SAMPLES = [
    ['No CORS headers at all',
     "Access to fetch at 'https://api.example.com/v1/me' from origin 'https://app.example.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource."],
    ['Wildcard + credentials',
     "Access to XMLHttpRequest at 'https://api.example.com/session' from origin 'https://app.example.com' has been blocked by CORS policy: The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'."],
    ['Preflight got a 401',
     "Access to fetch at 'https://api.example.com/orders' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status."],
    ['Header not allowed',
     "Access to fetch at 'https://api.example.com/orders' from origin 'http://localhost:5173' has been blocked by CORS policy: Request header field authorization is not allowed by Access-Control-Allow-Headers in preflight response."],
    ['Method not allowed',
     "Access to fetch at 'https://api.example.com/orders/12' from origin 'https://app.example.com' has been blocked by CORS policy: Method PATCH is not allowed by Access-Control-Allow-Methods in preflight response."],
    ['Origin mismatch',
     "Access to fetch at 'https://api.example.com/v1/me' from origin 'http://localhost:3000' has been blocked by CORS policy: The 'Access-Control-Allow-Origin' header has a value 'https://app.example.com' that is not equal to the supplied origin."],
    ['Firefox wording',
     "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://api.example.com/v1/me. (Reason: CORS header 'Access-Control-Allow-Origin' missing)."],
    ['Header added twice',
     "Access to fetch at 'https://api.example.com/v1/me' from origin 'https://app.example.com' has been blocked by CORS policy: The 'Access-Control-Allow-Origin' header contains multiple values '*, *', but only one is allowed."],
    ['Not actually CORS',
     "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://localhost:8443/api. (Reason: CORS request did not succeed). Status code: (null)"]
  ];

  $('#samples').innerHTML = SAMPLES.map((s, i) =>
    '<button class="stackbtn" data-sample="' + i + '">' + esc(s[0]) + '</button>').join('');
  Array.from(document.querySelectorAll('[data-sample]')).forEach(b => {
    b.onclick = () => { $('#input').value = SAMPLES[+b.dataset.sample][1]; run(); };
  });

  function run() {
    const text = $('#input').value.trim();
    if (!text) {
      statusEl.innerHTML = '<section><div class="err">Paste the error first, or pick one of the samples.</div></section>';
      outEl.hidden = true; return;
    }
    const hit = diagnose(text);
    if (!hit) {
      statusEl.innerHTML = '<section><div class="err">That does not look like a CORS error. ' +
        'The browser message usually contains &ldquo;blocked by CORS policy&rdquo;, ' +
        '&ldquo;Cross-Origin Request Blocked&rdquo; or &ldquo;Access-Control-Allow-Origin&rdquo;. ' +
        'Paste the whole line from the console, including the URLs.</div></section>';
      outEl.hidden = true; return;
    }
    statusEl.innerHTML = '';
    state = {
      hit: hit,
      stack: (state && state.stack) || 'nginx',
      shape: {
        method: hit.method || 'POST',
        credentials: /credential/i.test(text),
        contentType: 'application/json',
        headers: hit.header ? [hit.header] : ['Authorization']
      }
    };
    render();
  }

  function currentConfig() {
    const h = state.hit, sh = state.shape;
    const need = h.rule.need || {};
    const methods = ['GET', 'HEAD', 'POST', 'OPTIONS'];
    if (sh.method && methods.indexOf(sh.method) < 0) methods.push(sh.method);
    ['PUT', 'PATCH', 'DELETE'].forEach(m => { if (methods.indexOf(m) < 0) methods.push(m); });

    const headers = [];
    (sh.headers || []).forEach(x => { const v = x.trim(); if (v && headers.indexOf(v) < 0) headers.push(v); });
    if (sh.contentType && headers.indexOf('Content-Type') < 0) headers.push('Content-Type');
    if (!headers.length) headers.push('Content-Type');

    return {
      origin: h.info.origin,
      credentials: sh.credentials || !!need.credentials,
      methods: methods,
      headers: headers,
      expose: need.expose ? ['X-Total-Count', 'Location'] : [],
      privateNetwork: !!need.privateNetwork
    };
  }

  const BLAME = {
    server: ['bad', 'The server you are calling must change'],
    client: ['warn', 'Your page must change'],
    network: ['warn', 'Probably not CORS at all']
  };

  function render() {
    const h = state.hit, r = h.rule, info = h.info;
    const cfg = currentConfig();
    const pf = preflightNeeded(state.shape);
    const b = BLAME[r.blame];
    const H = [];

    /* verdict */
    H.push('<section><div class="card pad" style="border-color:var(--' +
      (r.blame === 'server' ? 'bad' : 'warn') + ')">');
    H.push('<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">');
    H.push('<h2 style="margin:0;font-size:19px;flex:1 1 320px">' + esc(r.title) + '</h2>');
    H.push('<span class="badge ' + b[0] + '" style="font-size:12px">' + esc(b[1]) + '</span>');
    H.push('</div>');
    H.push('<p style="margin:9px 0 0;color:var(--ink-2);font-size:14.5px">' + esc(r.what) + '</p>');
    H.push('</div></section>');

    /* what we read out of the error */
    H.push('<section><div class="card pad"><dl class="kv">');
    const row = (k, v) => { if (v) H.push('<dt>' + k + '</dt><dd>' + esc(v) + '</dd>'); };
    row('Your origin', info.origin || 'not found in the message');
    row('Calling', info.target || 'not found in the message');
    if (info.target && originOf(info.target)) row('Server origin', originOf(info.target));
    row('Reported by', info.browser);
    if (h.header) row('Blocked header', h.header);
    if (h.method) row('Blocked method', h.method);
    if (h.serverSays) row('Server currently allows', h.serverSays);
    if (info.status) row('Status code', String(info.status));
    row('Preflight involved', info.preflight ? 'yes — an OPTIONS request ran first' : 'not mentioned');
    H.push('</dl></div></section>');

    /* fix steps */
    H.push('<section><h2 style="font-size:17px;margin:0 0 11px">How to fix it</h2><ol class="steps">');
    r.steps.forEach(s => H.push('<li>' + esc(s) + '</li>'));
    H.push('</ol></section>');

    if (r.need) {
      /* request shape */
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Your request</h2><div class="card pad">');
      H.push('<div class="shape">');
      H.push('<div><label for="m">Method</label><select id="m">' +
        ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m =>
          '<option' + (m === state.shape.method ? ' selected' : '') + '>' + m + '</option>').join('') +
        '</select></div>');
      H.push('<div><label for="ct">Content-Type</label><select id="ct">' +
        ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain', '(none)']
          .map(m => '<option' + (m === state.shape.contentType ? ' selected' : '') + '>' + m + '</option>').join('') +
        '</select></div>');
      H.push('<div><label for="hs">Custom headers</label>' +
        '<input type="text" id="hs" value="' + esc((state.shape.headers || []).join(', ')) +
        '" placeholder="Authorization, X-Api-Key"></div>');
      H.push('<div><label for="cr">Credentials</label><select id="cr">' +
        '<option value="no"' + (state.shape.credentials ? '' : ' selected') + '>No cookies or auth session</option>' +
        '<option value="yes"' + (state.shape.credentials ? ' selected' : '') + '>Cookies / withCredentials</option>' +
        '</select></div>');
      H.push('</div>');
      H.push('<div class="note" style="margin-top:13px">' +
        (pf.preflight
          ? '<strong>This request is preflighted.</strong> The browser sends an <code>OPTIONS</code> request first because ' +
            pf.reasons.map(esc).join('; and ') + '. That preflight carries no cookies and no <code>Authorization</code> header, so it must succeed without authentication.'
          : '<strong>This is a simple request.</strong> No preflight is sent, so only the headers on the real response matter. ' +
            'Adding a custom header or a JSON content type would change that.') +
        '</div>');
      H.push('</div></section>');

      /* config */
      H.push('<section><h2 style="font-size:17px;margin:0 0 9px">Config for your server</h2>');
      H.push('<div class="stacks" style="margin-bottom:11px">' + STACKS.map(s =>
        '<button class="stackbtn' + (s === state.stack ? ' on' : '') + '" data-stack="' + esc(s) + '">' +
        esc(s) + '</button>').join('') + '</div>');
      H.push('<pre class="code" id="cfg">' + esc(gen(state.stack, cfg)) + '</pre>');
      H.push('<div class="row" style="margin-top:9px"><button class="primary" id="cp-cfg">Copy config</button>' +
        '<button id="cp-report">Copy the whole diagnosis</button></div>');
      if (!info.origin) H.push('<p class="muted" style="margin:9px 0 0">Your origin was not in the pasted text, so the config uses a placeholder — replace <code>https://your-app.example.com</code>.</p>');
      H.push('</section>');
    }

    /* always-true reminders */
    H.push('<section><div class="note"><strong>Two things that are true of every CORS error:</strong> ' +
      'the fix goes on the server being called, never on the calling page — and it working in ' +
      'curl or Postman tells you nothing, because CORS is enforced only by browsers.</div></section>');

    H.push('<section><div class="row"><button id="reset">Decode another error</button></div></section>');

    outEl.innerHTML = H.join('');
    outEl.hidden = false;

    const bind = (id, fn) => { const el = $(id); if (el) el.onchange = fn; };
    bind('#m', e => { state.shape.method = e.target.value; render(); });
    bind('#ct', e => { state.shape.contentType = e.target.value === '(none)' ? '' : e.target.value; render(); });
    bind('#cr', e => { state.shape.credentials = e.target.value === 'yes'; render(); });
    const hs = $('#hs');
    if (hs) hs.onchange = e => {
      state.shape.headers = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      render();
    };
    Array.from(outEl.querySelectorAll('[data-stack]')).forEach(btn => {
      btn.onclick = () => { state.stack = btn.dataset.stack; render(); };
    });
    const cp = $('#cp-cfg');
    if (cp) cp.onclick = () => copy(gen(state.stack, cfg), state.stack + ' config copied');
    const cr = $('#cp-report');
    if (cr) cr.onclick = () => copy(report(cfg, pf), 'Diagnosis copied');
    $('#reset').onclick = () => {
      outEl.hidden = true; outEl.innerHTML = ''; $('#input').value = '';
      state = null; window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  function report(cfg, pf) {
    const h = state.hit, r = h.rule;
    const L = ['CORS diagnosis', '', 'Problem: ' + r.title, 'Responsible: ' + BLAME[r.blame][1], ''];
    L.push(r.what, '');
    if (h.info.origin) L.push('Origin:  ' + h.info.origin);
    if (h.info.target) L.push('Target:  ' + h.info.target);
    L.push('Preflight: ' + (pf.preflight ? 'yes — ' + pf.reasons.join('; ') : 'no'), '');
    L.push('Fix:');
    r.steps.forEach((s, i) => L.push('  ' + (i + 1) + '. ' + s));
    if (r.need) { L.push('', state.stack + ' config:', '', gen(state.stack, cfg)); }
    L.push('', 'Decoded with https://papercuts-mauve.vercel.app/cors');
    return L.join('\n');
  }

  $('#decode').onclick = run;
  $('#clear').onclick = () => {
    $('#input').value = ''; outEl.hidden = true; outEl.innerHTML = '';
    statusEl.innerHTML = ''; state = null; $('#input').focus();
  };
  $('#input').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });
})();
