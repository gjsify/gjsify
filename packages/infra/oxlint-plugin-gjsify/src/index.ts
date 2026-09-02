// Internal oxlint JS plugin for gjsify.
//
// Loaded by oxlint via `jsPlugins` in `.oxlintrc.json` (referenced by source
// path — oxlint `import()`s this `.ts` file directly, relying on Node's
// type-stripping). oxlint's plugin host reads the module's DEFAULT export and
// expects a `{ meta: { name }, rules }` shape (see
// `refs/oxc/apps/oxlint/src-js/plugins/load.ts` → `registerPlugin`). The newer
// `definePlugin` helper is an identity function and is not exported by the
// published `oxlint@1.66/1.67`, so we export the plain object directly.
//
// NOT published to npm (`private: true`) — internal tooling only.

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
