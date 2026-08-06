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

### Options

| | |
|---|---|
| `-t, --template <name>` | Template to scaffold from. Required when stdin is not a TTY; otherwise prompted for. |
| `-f, --force` | Scaffold into a non-empty directory. |
| `--install` | Install dependencies after scaffolding. |
| `-p, --package-manager <pm>` | `npm` (default), `yarn`, `pnpm` or `gjsify`. Used for `--install` and for the commands printed in the next steps. |

`gjsify` is gjsify's own installer and the only one of the four that works on a
host with no Node.js at all.

## Templates

| Template | Runtimes | |
|---|---|---|
| `gtk-minimal` | GJS | `Gtk.Window` + `Gtk.Label`; no Adwaita, no Blueprint. |
| `adw-canvas2d` | GJS | Adwaita app rendering through the HTML Canvas 2D API (Blueprint UI). |
| `adw-webgl` | GJS | Adwaita app rendering through WebGL + three.js (Blueprint UI). |
| `adw-game` | GJS | Adwaita game shell on Excalibur.js; WebGL with a Canvas 2D fallback. |
| `cli` | GJS · Node · Bun · Deno | Command-line tool using yargs. |
| `web-server-hono` | GJS · Node · Bun · Deno | HTTP server using Hono (Web-standard fetch-style API). |
| `web-server-express` | GJS · Node · Bun · Deno | HTTP server using Express. |

The GTK/Adwaita templates drive libadwaita through `gi://`, so GJS is where they
belong. The other three ship two bundles — `--app gjs` and `--app node`, the
latter shared by Node, Bun and Deno, whose common ABI is Node-API. Each template
declares its own reach in `package.json` as `gjsify.example.runtimes`, and every
build names its `--app` target explicitly rather than inheriting whichever
runtime happens to invoke it.

## Operating systems

gjsify targets Linux, macOS and Windows (ADR 0018). What a scaffolded project
can do on each depends on the GNOME libraries installed there, not on gjsify.

## License

MIT
