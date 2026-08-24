// SolidJS JSX for Rolldown — the compile step a GTK/GJS Solid app needs.
//
// WHY BABEL AT ALL, in a repo that transforms everything else with oxc: Solid's
// JSX is not a runtime, it is a compiler. `babel-plugin-jsx-dom-expressions`
// turns `<gtk-box>…</gtk-box>` into straight-line calls against a renderer, and
// no oxc/SWC port of it exists. Rolldown's own transformer therefore CANNOT do
// this job — pointed at a `.tsx` with no JSX configuration it defaults to the
// automatic React runtime and emits `import { jsx } from "react/jsx-runtime"`,
// which resolves to nothing under GJS.
//
// WHY `generate: "universal"`: the default `"dom"` mode emits
// `document.createElement` plus `template()`/`cloneNode` cloning. There is no DOM
// under GJS, so that output cannot run at all. `"universal"` emits imports of the
// renderer ops from `moduleName` instead — measured on
// `gtk-host/type-tests/jsx/positive.tsx`, five of them:
//
//   import { createElement as _$createElement } from "@gjsify/gtk-host/solid";
//   import { insertNode   as _$insertNode   } from "@gjsify/gtk-host/solid";
//   import { setProp      as _$setProp      } from "@gjsify/gtk-host/solid";
//   import { insert       as _$insert       } from "@gjsify/gtk-host/solid";
//   import { use          as _$use          } from "@gjsify/gtk-host/solid";
//
// The names are LITERAL — they are the member names of Solid's
// `Renderer<NodeType>`, and the target module must re-export all of them under
// exactly those names. A renderer that exports eleven of the twelve builds fine
// and fails with MISSING_EXPORT on the twelfth, only for the JSX that happens to
// need it (that was `setProp`).
//
// Two further shapes the measurement fixed:
//  - Children are inserted BEFORE properties are set (`insertNode` then
//    `setProp`), so `createElement` never sees a prop. Construct-only properties
//    therefore cannot be handled by an adapter; the host has to defer
//    materialisation (ADR 0027 § Decision 5).
//  - Handlers arrive through `setProp` under their JSX spelling (`onClicked`),
//    not through a separate op.

import type { Plugin } from 'rolldown';

/** `babel-preset-solid`'s `generate` modes. Only `universal` can run on GJS. */
export type SolidGenerateMode = 'dom' | 'ssr' | 'universal';

export interface SolidPluginOptions {
    /**
     * Module the compiler imports the renderer ops from.
     *
     * Defaults to gjsify's GTK renderer. Any module works as long as it exports
     * every member of Solid's `Renderer<NodeType>` under its contract name.
     */
    moduleName?: string;
    /** Defaults to `universal`, the only mode with no DOM in its output. */
    generate?: SolidGenerateMode;
    /**
     * Which modules to compile. Defaults to `.jsx` / `.tsx` (also `.mtsx`,
     * `.ctsx`). A `.ts` file cannot contain JSX, so widening this is a mistake.
     */
    include?: RegExp;
}

/** Minimal structural view of the two lazily loaded Babel entry points. */
interface BabelCore {
    transformAsync: (
        code: string,
        options: Record<string, unknown>,
    ) => Promise<{ code?: string | null; map?: unknown } | null>;
}

const DEFAULT_INCLUDE = /\.(m|c)?[jt]sx$/;
const DEFAULT_MODULE_NAME = '@gjsify/gtk-host/solid';

/**
 * Loaded on first transform, not at import.
 *
 * Same contract as `@gjsify/rolldown-plugin-deepkit`: the heavy compiler stays
 * uninstantiated for every build that has no JSX in it, and a project that never
 * writes JSX never pays Babel's load time.
 */
let cached: Promise<{ babel: BabelCore; presets: unknown[] }> | null = null;

async function load(moduleName: string, generate: SolidGenerateMode) {
    if (cached) return cached;
    cached = (async () => {
        const babel = (await import('@babel/core')) as unknown as BabelCore;
        // Both presets are CommonJS, so the namespace carries them on `default`.
        // Their types come from `src/babel-presets.d.ts` — neither ships any.
        const { default: solid } = await import('babel-preset-solid');
        const { default: typescript } = await import('@babel/preset-typescript');
        // ORDER IS LOAD-BEARING AND REVERSED: Babel applies presets last-to-first,
        // so `preset-typescript` runs first and strips the annotations, and
        // `babel-preset-solid` then sees plain JSX. The other order makes Solid's
        // visitor walk TypeScript syntax it does not model.
        return {
            babel,
            presets: [
                [solid, { generate, moduleName }],
                [typescript, { isTSX: true, allExtensions: true }],
            ],
        };
    })();
    return cached;
}

/**
 * Compile Solid JSX to renderer calls.
 *
 * Wire it through `package.json#gjsify` so no JS-form config file is needed:
 *
 * ```json
 * "gjsify": { "bundler": { "plugins": [{ "name": "@gjsify/rolldown-plugin-solid" }] } }
 * ```
 */
export function solidPlugin(options: SolidPluginOptions = {}): Plugin {
    const moduleName = options.moduleName ?? DEFAULT_MODULE_NAME;
    const generate = options.generate ?? 'universal';
    const include = options.include ?? DEFAULT_INCLUDE;

    return {
        name: 'gjsify-solid',
        transform: {
            // Before every other JS transform: what follows must never see JSX.
            order: 'pre' as const,
            async handler(code: string, id: string) {
                if (!include.test(id)) return null;

                const { babel, presets } = await load(moduleName, generate);
                const result = await babel.transformAsync(code, {
                    // The consumer's own Babel config must not reach this: the
                    // preset chain above is the contract, and a stray `.babelrc`
                    // in a monorepo root would silently change the output.
                    babelrc: false,
                    configFile: false,
                    filename: id,
                    sourceFileName: id,
                    sourceMaps: true,
                    presets,
                });

                const transformed = result?.code;
                if (typeof transformed !== 'string') {
                    // Babel returning no code for a file that matched the filter is
                    // not a "nothing to do" — it is a silent drop, and returning
                    // null here would ship the untransformed JSX onwards.
                    throw new Error(
                        `@gjsify/rolldown-plugin-solid: Babel produced no output for ${id}. ` +
                            `The file matched ${String(include)} and was expected to contain Solid JSX.`,
                    );
                }
                return { code: transformed, map: (result?.map ?? null) as null };
            },
        },
    };
}

export default solidPlugin;
