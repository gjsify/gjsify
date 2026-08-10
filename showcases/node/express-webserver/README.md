# @gjsify/example-node-express-webserver

An Express 5 blog showcase — JSON API + static frontend — running on GJS using gjsify's Node.js polyfills (`@gjsify/http` over libsoup 3). The same source also builds for Node.js, Bun and Deno, demonstrating that a real Express web application runs unmodified on GJS via the `@gjsify/*` Node API layer.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Targets

| Target | Bundle | Platform glue |
|---|---|---|
| GJS | `dist/index.gjs.js` (`--app gjs`) | `@gjsify/http` + `@gjsify/http-soup-bridge` → libsoup 3 |
| Node · Bun · Deno | `dist/index.node.mjs` (`--app node`) | the runtime's own `node:http` |

One unchanged Express app, both bundles — no server-side forks. Declared portable across Linux, macOS and Windows (`gjsify.os`).

## Prerequisites

GJS ≥ 1.86 with libsoup 3. `gjsify system-check` reports what is missing.

## Run

```bash
# Build first (gjs + node bundles and the static frontend)
gjsify run build

# GJS (Express over GJS + Soup HTTP)
gjsify showcase express-webserver
# or: gjsify run start

# Node.js / Bun / Deno (for comparison)
gjsify showcase express-webserver --runtime node   # or: bun | deno
# or: gjsify run start:node
```

Then open `http://localhost:3000` in a browser.

## Routes

| Route | Serves |
|---|---|
| `GET /` | the static frontend from `src/public/` |
| `GET /api/posts` | the post list as JSON |
| `GET /api/posts/:slug` | a single post as JSON |
| `GET /api/runtime` | which runtime is serving the request |
| `GET /posts/:slug` | server-rendered post page |

## What it demonstrates

- Express 5 running **unmodified** on GJS with gjsify's `@gjsify/http` (libsoup 3 backend)
- The Node HTTP server surface Express builds on — `http.createServer`, request/response streams, headers, status codes — implemented over GNOME libraries
- Express middleware and routing on GJS: `express.json()`, custom middleware, route params, `express.static()`
- JSON REST API + static file serving from a single Express app
- The same source building for `--app gjs` and `--app node`, and ONE `--app node` bundle serving Node, Bun and Deno (Node-API is their common ABI)
- Node.js polyfill-layer compatibility with an unmodified npm package — the showcase is a compatibility probe, so any gap surfaces here and is fixed in the package, not worked around here

## Layout

```
src/
  index.ts             the Express app (routes, middleware, listen)
  data/posts.ts        the in-memory post data
  public/              static frontend (index.html, app.js, style.css)
```

## Related

- [`@gjsify/http`](../../../packages/node/http) — the `node:http` implementation this exercises
- [`@gjsify/http-soup-bridge`](../../../packages/node/http-soup-bridge) — the libsoup 3 transport behind it
- [`minimalist-browser`](../../dom/minimalist-browser) — the browser-side counterpart (WebKit content area on GJS)

## License

MIT
