// oxlint JS plugin for gjsify — PUBLISHED as `@gjsify/oxlint-plugin-gjsify`.
//
// oxlint loads a plugin via `jsPlugins` in `.oxlintrc.json`, and its plugin host
// reads the module's DEFAULT export expecting a `{ meta: { name }, rules }` shape
// (see `refs/oxc/apps/oxlint/src-js/plugins/load.ts` → `registerPlugin`). The newer
// `definePlugin` helper is an identity function and is not exported by the
// published `oxlint@1.66/1.67`, so we export the plain object directly.
//
// TWO LOADING PATHS, one source. This repo's own `.oxlintrc.json` names the SOURCE
// path (`src/index.ts`) — oxlint `import()`s it directly and Node's type-stripping
// handles the types, so `gjsify lint` needs no build step — while a consumer names
// the PACKAGE and gets `lib/index.js` from `tsc` (see `tsconfig.build.json`).
// `rewriteRelativeImportExtensions` is what lets one set of `./x.ts` imports serve
// both, so neither path needs its own copy of the rules.

import { deferredProcessExitRule } from './deferred-process-exit.ts';
import { noCssSideEffectImportRule } from './no-css-side-effect-import.ts';
import { noLiteralWidgetLabelRule } from './no-literal-widget-label.ts';
import { preferBlueprintTemplateRule } from './prefer-blueprint-template.ts';
import { registerClassOrderRule } from './register-class-order.ts';
import { spawnNodeBinaryRule } from './spawn-node-binary.ts';
import { todoNeedsAnchorRule } from './todo-needs-anchor.ts';
import type { Plugin } from './types.ts';

const plugin: Plugin = {
    meta: {
        name: 'gjsify',
    },
    rules: {
        'deferred-process-exit': deferredProcessExitRule,
        'no-css-side-effect-import': noCssSideEffectImportRule,
        'no-literal-widget-label': noLiteralWidgetLabelRule,
        'prefer-blueprint-template': preferBlueprintTemplateRule,
        'register-class-order': registerClassOrderRule,
        'spawn-node-binary': spawnNodeBinaryRule,
        'todo-needs-anchor': todoNeedsAnchorRule,
    },
};

export default plugin;
