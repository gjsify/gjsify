# @gjsify/console

GJS implementation of the Node.js `console` module with stream support.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/console

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/console
yarn add @gjsify/console
```

## Usage

```typescript
import { Console } from '@gjsify/console';

const logger = new Console(process.stdout, process.stderr);
logger.log('hello');
logger.error('something went wrong');
```

## Value formatting

Arguments are rendered with `JSON.stringify`, not `util.inspect` — a deliberate
simplification, so object output is `{"a":1}` where Node prints `{ a: 1 }`.

An **Error** is the one value that cannot go through `JSON.stringify`: it keeps only
own *enumerable* properties, and `message`/`stack` are neither, so
`console.error(new Error('boom'))` used to print `{}` and an error subclass carrying a
code printed `{"name":"GtkHostError","code":"unknown-tag"}` — the code and nothing else.
Errors are therefore rendered as `Name: message`, the stack, and the remaining own
enumerable properties as JSON, plus `[cause]` and `[errors]` (an `AggregateError`'s
members), recursively and cycle-safe. Nested errors inside an array or object are
rendered too.

The header is built from `name`/`message` rather than taken from `err.stack`, because
the engines disagree: V8 prefixes the stack with `Name: message`, SpiderMonkey does not
(frames only, measured on gjs 1.88.1).

### GErrors

A **GJS GError** — `new GLib.Error(Gio.IOErrorEnum, …)`, and everything a GI call
throws — is not an `Error` instance (`instanceof` is false; only the `Error.isError`
brand check sees it) and has **no `name` at all**: `Error.prototype` is not on its
prototype chain. Its identity lives in `domain`/`code`, which are accessors on the
prototype and therefore invisible to `Object.keys`. So the header comes from the
GError's own `toString` — `Gio.IOErrorEnum: no such file`, which names the domain —
and `domain`/`code` are appended:

```
Gio.IOErrorEnum: no such file
@file:///app/main.js:12:12 {"domain":198,"code":1}
```

`stack`, `fileName`, `lineNumber` and `columnNumber` are never appended as properties.
They are non-enumerable on a plain `new Error()` but own-*enumerable* on a GError, and
they hold exactly the file, line and column the printed stack already shows.

### Reporting never throws

Every slot the renderer reads off an Error — `name`, `message`, `stack`, `cause`,
`errors`, each own property — can be an accessor, and an accessor can throw. Each is
read defensively, so a poisoned slot costs that slot and not the log line, and the
whole render is wrapped as a last resort: an Error that cannot be rendered at all
degrades to `Name: message [unformattable: <why>]`. A console that throws while
reporting a failure replaces the report with a second failure.

## Inspirations and credits

- https://github.com/denoland/deno/tree/main/ext/console

## License

MIT
