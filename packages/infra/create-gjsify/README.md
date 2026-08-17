# @gjsify/create-app

Scaffolding tool for creating new Gjsify projects.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js, Web and
DOM APIs for GJS (GNOME JavaScript), plus Node.js, Bun and Deno.

## Usage

```bash
gjsify create my-app

# npm, yarn and pnpm create also work:
npm create @gjsify/app my-app
yarn create @gjsify/app my-app
pnpm create @gjsify/app my-app
```

On a terminal it asks three questions in order — template, runtime, package
manager — each narrowing the next. Every question can be answered by a flag
instead, which is also how it is driven without a TTY.

### Options

| | |
|---|---|
| `-t, --template <name>` | Template to scaffold from. Required when stdin is not a TTY; otherwise prompted for. |
| `-r, --runtime <rt>` | Runtime to set the project up for — one of the runtimes the chosen template declares. Decides which package managers are offered and which start script the next steps name. |
| `-f, --force` | Scaffold into a non-empty directory. |
| `--install` | Install dependencies after scaffolding. |
| `-p, --package-manager <pm>` | Must be one the chosen runtime can install for (see below). Used for `--install` and for the commands printed in the next steps. |

### Runtime → package manager

An installer has to produce the module layout its runtime resolves against, so
the runtime decides which managers are on offer:

| Runtime | Package managers |
|---|---|
| `gjs` | `gjsify` |
| `node` | `npm`, `yarn`, `pnpm`, `gjsify` |
| `bun` | `bun` |
| `deno` | `deno` |

Where a runtime offers exactly one, nothing is asked — it is used and named.
`gjsify` is gjsify's own installer and the only one of the six that works on a
host with no Node.js at all, which is why it is what the `gjs` column installs
with.

Passing `-p` without `-r` settles the runtime too: `-p bun` sets the project up
for Bun, `-p gjsify` for GJS. Off a TTY, `--runtime` and `--package-manager` are
reported when they fall back to a default rather than being assumed silently —
and `--package-manager` is *required* alongside `--install`, since that is the
one flag whose default would reach your disk.

## Templates

| Template | |
|---|---|
| `gtk-minimal` | `Gtk.Window` + `Gtk.Label`; no Adwaita, no Blueprint. |
| `adw-canvas2d` | Adwaita app rendering through the HTML Canvas 2D API (Blueprint UI). |
| `adw-webgl` | Adwaita app rendering through WebGL + three.js (Blueprint UI). |
| `adw-game` | Adwaita game shell on Excalibur.js; WebGL with a Canvas 2D fallback. |
| `cli` | Command-line tool using yargs. |
| `web-server-hono` | HTTP server using Hono (Web-standard fetch-style API). |
| `web-server-express` | HTTP server using Express. |

Each template declares its own reach in `package.json` as
`gjsify.example.runtimes`, and the runtime prompt offers exactly that — no list
is kept here, because a second copy is the one that goes stale. Templates ship
two bundles, `--app gjs` and `--app node`, the latter shared by Node, Bun and
Deno, whose common ABI is Node-API; every build names its `--app` target
explicitly rather than inheriting whichever runtime happens to invoke it.

## Operating systems

gjsify targets Linux, macOS and Windows (ADR 0018). What a scaffolded project
can do on each depends on the GNOME libraries installed there, not on gjsify.

## License

MIT
