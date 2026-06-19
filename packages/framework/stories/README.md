# @gjsify/stories

The runtime-agnostic **story-authoring contract** for gjsify's storybook. It defines the vocabulary every renderer shares — control kinds, argument maps, and story metadata — with **zero platform imports**, so the GTK renderer ([`@gjsify/storybook`](../../framework/storybook)) and any future web / NativeScript renderer can consume one set of types.

## Exports

- `ControlType` — `TEXT | NUMBER | BOOLEAN | SELECT | RANGE | COLOR`
- `StoryControl` — discriminated union (per-kind fields type-checked: `min`/`max`/`step` only on `NUMBER`/`RANGE`, `options` only on `SELECT`)
- `StoryArgs` / `StoryArgValue` — the live argument map a story renders from
- `StoryMeta<TComponent>` — `title` (`"Category/Name"`), `description`, `component`, `tags`, `controls`
- `StoryModule<TWidget>` / `StoryComponentConstructor<TWidget>` — the registration shape a renderer fills with instances
- `StoryDecorator<TWidget>` — wraps a story's build step
- `argsFromControls(controls)` — derive initial args from control defaults (defaults spelled once)
- `isStoryModule(value)` — narrowing guard used by story auto-discovery

## Usage

```ts
import { ControlType, type StoryControl, argsFromControls } from '@gjsify/stories';

const controls: StoryControl[] = [
    { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Click me' },
    { name: 'size', label: 'Size', type: ControlType.RANGE, min: 16, max: 96, step: 2, defaultValue: 42 },
];

const args = argsFromControls(controls); // { label: 'Click me', size: 42 }
```

You normally do not import this package directly to author a story — you import the **renderer** (`@gjsify/storybook`), which re-exports this contract alongside its `StoryWidget` base class. Import `@gjsify/stories` directly only when writing a new renderer or renderer-agnostic tooling.

## Build / test

```bash
gjsify workspace @gjsify/stories build
gjsify workspace @gjsify/stories test
```

The contract is pure TypeScript with no platform imports, so a future `@gjsify/storybook-web` / `-nativescript` renderer can reuse it. Today the only renderer is `@gjsify/storybook` (GTK), so the package is declared `gjs`-only (it lives on the framework axis); a cross-runtime renderer would bump the `gjsify.runtimes` slots and add a `src/test.browser.mts`.
