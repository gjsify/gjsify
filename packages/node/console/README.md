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

## Inspirations and credits

- https://github.com/denoland/deno/tree/main/ext/console

## License

MIT
