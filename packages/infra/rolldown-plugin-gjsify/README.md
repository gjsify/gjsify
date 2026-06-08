# @gjsify/rolldown-plugin-gjsify

The core Rolldown plugin set powering `gjsify build`. Orchestrates per-target app builds for GJS, Node, Browser, and NativeScript — handling Node↔GJS module aliasing, automatic globals injection (`--globals auto`), CSS-as-string loading (via `@gjsify/lightningcss-native` or the npm fallback), platform-file resolution (`.android.ts` / `.ios.ts`), process-stub injection, shebang hoisting, and more.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/rolldown-plugin-gjsify
```

## Usage

Typically consumed via the gjsify CLI (`gjsify build --app gjs`). For direct use in a custom Rolldown config:

```typescript
import rolldown from 'rolldown';
import { setupForGjs } from '@gjsify/rolldown-plugin-gjsify';

const { options, plugins } = await setupForGjs({
    input: 'src/index.ts',
    globals: 'auto',
});

const build = await rolldown({ ...options, plugins });
await build.write({ file: 'dist/app.gjs.mjs' });
```

Individual plugins are also exported for use in custom pipelines:

```typescript
import {
    cssAsStringPlugin,
    gjsImportsEmptyPlugin,
    processStubPlugin,
    shebangPlugin,
    textLoaderPlugin,
    platformResolvePlugin,
} from '@gjsify/rolldown-plugin-gjsify';
```

## License

MIT
