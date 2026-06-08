# @gjsify/rolldown-plugin-deepkit

A Rolldown (and Rollup/Vite-compatible) plugin that runs the Deepkit TypeScript runtime-reflection transform (`@deepkit/type-compiler`) during gjsify builds. Opt-in only — disabled by default to avoid transforming projects that do not use Deepkit runtime types.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/rolldown-plugin-deepkit
```

## Usage

Enable via `.gjsifyrc.js` in your project (the gjsify CLI picks this up automatically):

```javascript
// .gjsifyrc.js
export default {
    typescript: { reflection: true },
};
```

Or use the plugin directly in a Rolldown / Vite config:

```typescript
import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';

export default {
    plugins: [deepkitPlugin({ reflection: true })],
};
```

Keep `reflection: false` (the default) unless your project explicitly uses `@deepkit/type` runtime types — the transform rewrites TypeScript in a way that can break non-Deepkit code.

## License

MIT
