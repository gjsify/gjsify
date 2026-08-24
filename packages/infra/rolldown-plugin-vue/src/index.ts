// Vue single-file components for Rolldown — the compile step a GTK/GJS Vue app
// needs, and the half that did not exist while the adapter did.
//
// `@gjsify/gtk-host/vue` is a `@vue/runtime-core` custom renderer, and it was
// exercised through the renderer calls an SFC template compiles TO, never through
// `@vue/compiler-sfc`. Nothing in the repository compiled a `.vue` file.
//
// ONE DECISION SHAPES THE WHOLE FILE, and it is not the obvious one. Rolldown picks
// a parser from the id's EXTENSION, and `.vue` is not one it knows: hand it
// TypeScript on a `.vue` id and the build dies with `[PARSE_ERROR] Missing
// initializer in const declaration` pointing INTO the `.vue` file. The designed fix
// is `moduleType` on a transform result — real, documented API in rolldown 1.1.4's
// `SourceDescription` — and it is unusable here: `@gjsify/rolldown-native`'s
// `plugin_proxy.rs::parse_module_type` accepts js/ecmascript/json/text and rejects
// the rest, so `moduleType: 'ts'` builds under Node and fails under GJS, the primary
// target. So this plugin renames the module id in `resolveId` and compiles in
// `load`, which is the only one of the three candidates measured working on BOTH
// engines. The table of what each did is in the README; the core gap is recorded in
// `status/open-todos.md`.
//
// Everything else worth knowing is at its call site, because each one is a way this
// compiles green and renders wrong.

import { readFile } from 'node:fs/promises';

import type { Plugin } from 'rolldown';
// A TYPE-only namespace import: erased at compile time, so naming the compiler here
// does not load it. `typeof import(…)` would say the same thing and is refused by
// `consistent-type-imports`.
import type * as VueCompilerSfc from '@vue/compiler-sfc';

import { type CombinedSourceMap, type SourceMapChunkMap, combineSourceMaps } from './source-map.js';

/** `@vue/compiler-sfc`, loaded lazily on the first `.vue` module. */
type CompilerSfc = typeof VueCompilerSfc;

/** The component object every emitted module builds and exports. */
const SFC_BINDING = '__sfc__';
/** The render function, renamed out of the way of a user's own `render`. */
const RENDER_BINDING = '__sfc_render__';
/**
 * Appended to the resolved `.vue` path so rolldown's extension-based parser
 * selection reaches TypeScript. Fact 5 above.
 *
 * Named rather than a bare `.ts` so no real file can collide with it: a project
 * that genuinely has an `App.vue.ts` on disk would otherwise see this plugin claim
 * its `load` and compile `App.vue` in its place.
 */
const VIRTUAL_SUFFIX = '.gjsify-vue.ts';

const DEFAULT_INCLUDE = /\.vue$/;
const DEFAULT_RUNTIME_MODULE_NAME = '@vue/runtime-core';

export interface VuePluginOptions {
    /**
     * Which tags compile to an ELEMENT vnode instead of a component lookup.
     *
     * Defaults to {@link isGtkHostTag}. Widen it for a project that registers
     * widgets under another prefix; narrow it and a GTK tag silently becomes a
     * component lookup that resolves to nothing.
     */
    isCustomElement?: (tag: string) => boolean;
    /** Which modules to compile. Defaults to `.vue`. */
    include?: RegExp;
    /**
     * Module the generated code imports Vue's runtime from.
     *
     * Defaults to `@vue/runtime-core`, which is what the gjsify adapter builds on.
     * `vue` — the compiler's own default — pulls `@vue/runtime-dom` and the DOM
     * renderer into a bundle that has no DOM.
     */
    runtimeModuleName?: string;
}

/**
 * The default tag rule: `gtk-`/`adw-` kebab, or `Gtk`/`Adw` + a capital.
 *
 * A PREFIX RULE, deliberately, and its authority lies elsewhere — this predicate
 * only decides "element vnode or component lookup", never whether the widget
 * exists. An unknown tag is refused BY NAME twice: `@gjsify/gtk-host`'s registry
 * throws `unknown-tag` at render time, and `GlobalComponents` + `strictTemplates`
 * refuses it at type-check. Encoding the widget list here would be a third copy of
 * a generated table, and the first one to drift.
 *
 * It covers that table exactly: all 164 GType keys in
 * `gtk-host/src/generated/props.ts` match `^(Gtk|Adw)[A-Z]`, so every kebab tag
 * derived from them matches `^(gtk|adw)-`.
 */
export const isGtkHostTag = (tag: string): boolean => /^(gtk|adw)-/.test(tag) || /^(Gtk|Adw)[A-Z]/.test(tag);

/**
 * Loaded on first compile, not at import.
 *
 * Same contract as `@gjsify/rolldown-plugin-solid` and
 * `@gjsify/rolldown-plugin-deepkit`: a build with no `.vue` in it never pays for
 * `@vue/compiler-sfc` (which pulls in `@babel/parser`, `postcss` and
 * `magic-string`), and under `--app gjs` the CLI bundles this plugin for GJS before
 * importing it, so that whole tree has to load under GJS as well.
 */
let cached: Promise<CompilerSfc> | null = null;

function load(): Promise<CompilerSfc> {
    cached ??= import('@vue/compiler-sfc');
    return cached;
}

/**
 * FNV-1a over filename + source, hex.
 *
 * The SFC "id" is Vue's scope id: it keys `<style scoped>` attribute selectors and
 * `v-bind()` CSS variables. Both are out of scope here, so all this value needs is
 * to be stable and collision-free per module — and to be computed WITHOUT
 * `node:crypto`, because this plugin runs inside a CLI that runs on GJS.
 */
function scopeId(filename: string, source: string): string {
    let hash = 0x811c9dc5;
    const input = `${filename} ${source}`;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        // The 32-bit FNV prime, multiplied through Math.imul so it stays an int32.
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Refuse a `<script lang>` this plugin cannot place behind a `.ts` id.
 *
 * The suffix is chosen in `resolveId`, before anything has read the file, so it
 * cannot depend on the block's `lang` — and a JSX dialect needs a `.tsx`/`.jsx` id
 * to parse at all. Refusing by name beats emitting code rolldown will then fail to
 * parse with a message about the generated line rather than about the `lang`.
 */
function assertSupportedLang(lang: string | undefined, filename: string): void {
    if (lang === undefined || lang === 'js' || lang === 'ts') return;
    throw new Error(
        `@gjsify/rolldown-plugin-vue: ${filename} declares <script lang="${lang}">, which this plugin does not ` +
            `compile. Supported: no lang, "js", "ts". A JSX dialect inside an SFC script would need the module id ` +
            `to end in .jsx/.tsx, which is decided before the file is read; write JSX in a .tsx file and compile it ` +
            `with @gjsify/rolldown-plugin-solid instead.`,
    );
}

/**
 * Refuse a `<style>` block by name rather than dropping it.
 *
 * GTK styling is a `Gtk.CssProvider` concern: there is no element a CSS rule could
 * attach to here, and `<style scoped>` compiles to an attribute selector GTK4 CSS
 * does not even have. Compiling the rest and saying nothing is the exact failure
 * shape this repository keeps eliminating — the app builds, runs, looks wrong, and
 * nothing anywhere mentions the stylesheet.
 */
function refuseStyleBlocks(styles: readonly { scoped?: boolean }[], id: string): void {
    if (styles.length === 0) return;
    const scoped = styles.filter((style) => style.scoped === true).length;
    throw new Error(
        `@gjsify/rolldown-plugin-vue: ${id} has ${styles.length} <style> block(s)` +
            `${scoped > 0 ? ` (${scoped} scoped)` : ''}, which this plugin does not compile. GTK styling goes ` +
            `through a Gtk.CssProvider: load the CSS yourself with Gtk.CssProvider.load_from_string() plus ` +
            `Gtk.StyleContext.add_provider_for_display(), and put the selector on the widget with cssClasses. ` +
            `Dropping the block silently would build an app that renders unstyled with nothing to read about it.`,
    );
}

/**
 * Refuse a `<template src>` / `<script src>` by name rather than compiling half a
 * component.
 *
 * Measured: `<template src="./tpl.html"/>` beside a `<script setup>` compiles to
 * `function __sfc_render__() { return null }`, and `<script src="./s.js">` beside a
 * template compiles to `const __sfc__ = {}` with the external module never imported.
 * Either way the app builds, runs, and renders a blank or logic-less component with
 * nothing anywhere to read about it. `<script setup src>` never reaches here —
 * `parse()` itself rejects it ("cannot use the src attribute because its syntax will be
 * ambiguous outside of the component"), which `compileSfc` reports as an invalid SFC.
 */
function refuseExternalBlocks(blocks: readonly (readonly [string, { src?: string } | null])[], filename: string): void {
    for (const [kind, block] of blocks) {
        if (block?.src === undefined) continue;
        throw new Error(
            `@gjsify/rolldown-plugin-vue: ${filename} has <${kind} src="${block.src}">, which this plugin does ` +
                `not compile: it resolves no external block, so the ${kind} would be silently EMPTY — a component ` +
                `that renders blank or carries none of its logic, at exit 0. Inline the ${kind} into the SFC.`,
        );
    }
}

/**
 * Refuse a `<template lang>` this plugin does not run through a preprocessor.
 *
 * Nothing validated it before, and the failure is silent in the worst way: measured,
 * `<template lang="pug">` compiles to a render function that RETURNS THE PUG SOURCE AS A
 * TEXT NODE. The app builds and shows its own template markup.
 */
function assertSupportedTemplateLang(lang: string | undefined, filename: string): void {
    if (lang === undefined || lang === 'html') return;
    throw new Error(
        `@gjsify/rolldown-plugin-vue: ${filename} declares <template lang="${lang}">, which this plugin does not ` +
            `compile — it runs no template preprocessor, and the block would be compiled as if it were HTML: ` +
            `measured, a pug template became a render function returning the pug source as a text node. ` +
            `Write the template as HTML.`,
    );
}

/**
 * `NodeTypes.ELEMENT` / `NodeTypes.ATTRIBUTE` / `NodeTypes.DIRECTIVE` and
 * `ElementTypes.ELEMENT`, from `@vue/compiler-core`'s enums.
 *
 * Spelled as literals because `@vue/compiler-sfc` re-exports neither enum, and taking
 * `@vue/compiler-core` as a second direct dependency for four integers would also put it
 * in the tree this plugin loads lazily. Each one is load-bearing for a refusal below, so
 * a renumbering upstream turns those specs RED rather than turning the refusals off.
 */
const NODE_ELEMENT = 1;
const PROP_ATTRIBUTE = 6;
const PROP_DIRECTIVE = 7;
const TAG_PLAIN_ELEMENT = 0;

/** The slice of the template AST the refusal below reads. */
interface TemplateNode {
    type: number;
    tag?: string;
    tagType?: number;
    props?: readonly TemplateProp[];
}

interface TemplateProp {
    type: number;
    /** An attribute's own name, or a directive's name with the `v-` already stripped. */
    name: string;
    arg?: { content?: unknown; isStatic?: boolean };
    modifiers?: readonly { content?: unknown }[];
}

/** How the `@vue/runtime-dom` half of a feature would have failed on GTK. */
const MISSING_EXPORT =
    'is a @vue/runtime-dom export, which @vue/runtime-core does not have: rolldown reports the missing import ' +
    'as a WARNING at exit 0 and the app then calls `undefined` inside a GLib callback';
const UNKNOWN_PROP =
    'compiles to a DOM prop no GTK widget has, which @gjsify/gtk-host refuses as `unknown-prop` at RENDER time ' +
    '— inside a GLib callback, where GJS prints `JS ERROR` and the process still exits 0';

/**
 * `v-<name>` → why it cannot compile here, and what to write instead.
 *
 * `plainElementsOnly` spares the legitimate use: measured, `v-model` on a COMPONENT
 * compiles to `modelValue` + `onUpdate:modelValue` props and imports nothing DOM-shaped,
 * while `v-model` on an element reaches for `vModelText`/`vModelCheckbox`/`vModelDynamic`.
 */
const DOM_ONLY_DIRECTIVES: readonly { name: string; plainElementsOnly: boolean; why: string }[] = [
    {
        name: 'show',
        plainElementsOnly: false,
        why:
            `\`vShow\` ${MISSING_EXPORT}. It toggles \`style.display\`, which GTK has no equivalent for: use ` +
            `\`v-if\`, or bind the widget's own \`visible\` property.`,
    },
    {
        name: 'model',
        plainElementsOnly: true,
        why:
            `\`vModelText\`/\`vModelCheckbox\`/\`vModelDynamic\` ${MISSING_EXPORT}. Bind the widget property and ` +
            `write it back from the widget's own signal: \`<gtk-entry :text="name" @changed="…" />\`.`,
    },
    {
        name: 'html',
        plainElementsOnly: false,
        why:
            `\`v-html\` ${UNKNOWN_PROP} (\`innerHTML\`). GTK parses no HTML — put the text in the widget's own ` +
            `\`label\` property, or use Pango markup with \`useMarkup\`.`,
    },
    {
        name: 'text',
        plainElementsOnly: false,
        why:
            `\`v-text\` ${UNKNOWN_PROP} (\`textContent\`). Write the text as a child — ` +
            `\`<gtk-label>{{ text }}</gtk-label>\` — or bind the widget's \`label\` property.`,
    },
];

/**
 * DOM props whose NAME survives compilation but which no GTK widget has.
 *
 * `style` reaches this list as a `v-bind`, not as an attribute: compiler-dom's
 * `transformStyle` rewrites `style="color: red"` into a bound style OBJECT before any
 * directive transform runs, so the static and bound spellings are indistinguishable here
 * — and both are refused. `class` stays a plain attribute.
 */
const DOM_ONLY_PROPS = new Map([
    [
        'class',
        `\`class\` ${UNKNOWN_PROP}. The GTK property is \`cssClasses\`, a string ARRAY: ` +
            `\`<gtk-box :css-classes="['card']" />\`.`,
    ],
    [
        'style',
        `\`style\` ${UNKNOWN_PROP}. GTK styling is a \`Gtk.CssProvider\` concern: load the CSS with ` +
            `\`Gtk.CssProvider.load_from_string()\` plus \`Gtk.StyleContext.add_provider_for_display()\` and put ` +
            `the selector on the widget with \`cssClasses\`.`,
    ],
]);

/**
 * `<Transition>`/`<TransitionGroup>` in both spellings compiler-dom recognises.
 *
 * Measured: each emits `import { Transition } from "@vue/runtime-core"`, and both names
 * are ABSENT there — they live in `@vue/runtime-dom`, driven by CSS transition classes.
 * `@gjsify/gtk-host`'s README records the same fact from the runtime side.
 */
const DOM_ONLY_TAGS = new Map([
    ['Transition', 'Transition'],
    ['transition', 'Transition'],
    ['TransitionGroup', 'TransitionGroup'],
    ['transition-group', 'TransitionGroup'],
]);

/**
 * Refuse the template features that only mean something against a DOM, BY NAME.
 *
 * `compileTemplate` runs on `@vue/compiler-dom` — `@vue/compiler-sfc` ships no other
 * template compiler — so `DOMDirectiveTransforms` and `DOMNodeTransforms` are installed
 * and every feature below COMPILES. Each then fails in one of two ways, and neither stops
 * the app: an import `@vue/runtime-core` does not export, or a DOM prop no GTK widget
 * has. Both are spelled out in the messages above, because the point of refusing is that
 * someone reads why.
 *
 * A `nodeTransform` and not four `directiveTransforms`: two of these are not directives
 * at all (`transformStyle` keys off an attribute, `transformTransition` off the tag), and
 * an event MODIFIER is a property of a `v-on` this plugin must otherwise keep working.
 * One hook sees all of them on ENTRY, before `buildProps` runs on exit.
 */
function refuseDomOnlyTemplateFeatures(node: unknown, filename: string): void {
    // The compiler hands its own AST to a `nodeTransform` and `@vue/compiler-sfc` exports
    // no types for it, so the shape is asserted here rather than imported.
    const element = node as TemplateNode;
    if (element.type !== NODE_ELEMENT) return;
    const tag = element.tag ?? '<unknown>';

    const builtIn = DOM_ONLY_TAGS.get(tag);
    if (builtIn !== undefined) {
        refuse(
            filename,
            `<${tag}>`,
            `\`${builtIn}\` ${MISSING_EXPORT}. It animates CSS transition classes; a GTK animation is ` +
                `\`Adw.TimedAnimation\` or a widget's own transition property (\`Gtk.Stack.transitionType\`).`,
        );
    }

    for (const prop of element.props ?? []) {
        if (prop.type === PROP_ATTRIBUTE) {
            const why = DOM_ONLY_PROPS.get(prop.name);
            if (why !== undefined) refuse(filename, `\`${prop.name}\` on <${tag}>`, why);
            continue;
        }
        if (prop.type !== PROP_DIRECTIVE) continue;

        const directive = DOM_ONLY_DIRECTIVES.find((candidate) => candidate.name === prop.name);
        if (directive !== undefined && (!directive.plainElementsOnly || element.tagType === TAG_PLAIN_ELEMENT)) {
            refuse(filename, `\`v-${prop.name}\` on <${tag}>`, directive.why);
        }

        if (prop.name === 'bind' && prop.arg?.isStatic === true) {
            const why = DOM_ONLY_PROPS.get(String(prop.arg.content));
            if (why !== undefined) refuse(filename, `\`:${String(prop.arg.content)}\` on <${tag}>`, why);
        }

        const modifiers = prop.name === 'on' ? (prop.modifiers ?? []) : [];
        if (modifiers.length > 0) {
            const spelling = modifiers.map((modifier) => `.${String(modifier.content)}`).join('');
            refuse(
                filename,
                `\`@${String(prop.arg?.content ?? '')}${spelling}\` on <${tag}>`,
                `an event modifier compiles to \`withModifiers\`/\`withKeys\`, and both ${MISSING_EXPORT}. ` +
                    `They are DOM event plumbing (\`stopPropagation\`, \`event.key\`) — a GTK signal has neither. ` +
                    `Drop the modifier and do the check inside the handler.`,
            );
        }
    }
}

function refuse(filename: string, what: string, why: string): never {
    throw new Error(
        `@gjsify/rolldown-plugin-vue: ${filename} uses ${what}, which this plugin does not compile. ${why}`,
    );
}

/**
 * `export function render` becomes `function __sfc_render__`, so the emitted module
 * can hold a user's own `render` binding beside it.
 *
 * A string rewrite, like `@vitejs/plugin-vue`'s, because `compileTemplate` has no
 * rename option — but ASSERTED, because a silent no-op here would leave a second
 * `render` in the module (a redeclaration at best, a shadowed user binding at worst)
 * and the failure would surface in the app rather than in the build.
 */
function renameRenderExport(code: string, id: string): string {
    const renamed = code.replace(/\nexport function render\(/, `\nfunction ${RENDER_BINDING}(`);
    if (renamed === code) {
        throw new Error(
            `@gjsify/rolldown-plugin-vue: could not find the generated \`export function render(\` in the ` +
                `template output for ${id}. @vue/compiler-sfc changed its codegen shape; this plugin renames ` +
                `that export so it cannot collide with a user's own \`render\`.`,
        );
    }
    return renamed;
}

/** Every message an SFC/template compile can report, flattened for one throw. */
function messagesOf(errors: readonly unknown[]): string {
    return errors.map((error) => String((error as { message?: unknown }).message ?? error)).join('\n  ');
}

/** The emitted module and one map for it, over the whole `.vue` file. */
export interface CompiledSfc {
    code: string;
    /** `null` only when neither half produced a map — never a stand-in for "unmapped". */
    map: CombinedSourceMap | null;
}

/**
 * Compile one SFC's source to a component module.
 *
 * Split out of the hooks so the whole compile is reachable without a bundler —
 * which is what makes it testable at all.
 */
export async function compileSfc(
    source: string,
    filename: string,
    options: {
        isCustomElement: (tag: string) => boolean;
        runtimeModuleName: string;
        /**
         * Where a NAMED-but-not-fatal finding goes — a custom block, today.
         *
         * A custom block carries no runtime semantics of its own, so refusing one
         * would break a `<docs>` block that harms nothing; dropping it in silence is
         * the other half of the same mistake. It gets said out loud instead.
         */
        onWarn?: (message: string) => void;
    },
): Promise<CompiledSfc> {
    const { parse, compileScript, compileTemplate } = await load();
    const { isCustomElement, runtimeModuleName } = options;

    // BOTH options LOOK like codegen options and are really PARSER options, and
    // setting them where they look like they belong is a silent no-op — a tag's kind
    // (element vs component) and whether a comment survives are decided at parse
    // time. `@vitejs/plugin-vue` hands `compileTemplate` the `ast` from a plain
    // `parse()` and relies on Vite to have configured the parser; doing that here
    // measured 2 of 2 tags back to `_resolveComponent` while
    // `compilerOptions.isCustomElement` sat there set and ignored.
    //
    // That no-op also FAKED ITS OWN A/B: `compileTemplate` re-parses an ast that has
    // already been transformed, so a loop compiling the SAME descriptor three times
    // showed `comments: false` "working" on the second pass. Every measurement in
    // this package is from a fresh process.
    //
    // `comments` is here for a second reason: it defaults to `__DEV__`, i.e. to the
    // BUNDLER's `process.env.NODE_ENV`, which no build here sets. Measured, the same
    // SFC emitted 4 `createCommentVNode` calls with NODE_ENV unset and 0 with
    // NODE_ENV=production — a different bundle for an environment variable nothing
    // declares. It has to be set in `compilerOptions` AS WELL, and pinning it here
    // alone made the plugin non-deterministic WITHIN one process: `parse()` LRU-caches
    // the descriptor, `compileTemplate` marks the ast `transformed`, and the next
    // compile of the same file therefore takes `resolveTemplateAST`, which re-parses
    // `inAST.source` using `compilerOptions` as the PARSE options. Measured on one
    // fixture in one process: pass 1 emitted 0 `createCommentVNode` calls, pass 2
    // emitted 1, and the two modules differed.
    const { descriptor, errors } = parse(source, {
        filename,
        templateParseOptions: { isCustomElement, comments: false },
    });
    if (errors.length > 0) {
        throw new Error(`@gjsify/rolldown-plugin-vue: ${filename} is not a valid SFC:\n  ${messagesOf(errors)}`);
    }

    refuseStyleBlocks(descriptor.styles, filename);
    refuseExternalBlocks(
        [
            ['template', descriptor.template],
            ['script', descriptor.script],
        ],
        filename,
    );
    assertSupportedTemplateLang(descriptor.template?.lang ?? undefined, filename);
    for (const block of descriptor.customBlocks) {
        options.onWarn?.(
            `@gjsify/rolldown-plugin-vue: ${filename} carries a <${block.type}> block, which this plugin does ` +
                `not compile. Nothing in the bundle will read it.`,
        );
    }

    const hasScript = descriptor.script !== null || descriptor.scriptSetup !== null;
    assertSupportedLang(descriptor.scriptSetup?.lang ?? descriptor.script?.lang ?? undefined, filename);

    const compilerOptions = {
        isCustomElement,
        runtimeModuleName,
        // The adapter's contract, and it prevents a real throw rather than merely
        // honouring a prescription. `hoistStatic` (on by default) enables
        // compiler-dom's `stringifyStatic`, which turns a large enough static
        // subtree into `createStaticVNode("<html…>")` — and the adapter's
        // `insertStaticContent` THROWS, because GTK parses no HTML. It reaches GTK
        // tags too: MEASURED, 22 `<gtk-label title="t">x</gtk-label>` children
        // stringified exactly like 22 `<div>`s. (A first measurement with 22
        // self-closing, text-free labels did NOT stringify, and reading that as
        // "custom elements are exempt" is the kind of near-miss this comment exists
        // to stop.) `cloneNode` is the same class one step further out: a GObject
        // does not clone.
        hoistStatic: false,
        // Not `transformHoist: null` beside it: compiler-dom's `compile()` spreads its
        // own `transformHoist: stringifyStatic` AFTER the caller's options, so the null
        // never reached `baseCompile`. Measured with `hoistStatic: true`, `null` and
        // `undefined` emitted the same 1 `createStaticVNode(` and byte-identical output;
        // `hoistStatic: false` is what actually suppresses it.
        comments: false,
        // The refusals this plugin owns, reached the only way a caller can reach them:
        // compiler-dom appends `options.nodeTransforms` after its own, so this runs on
        // entry to every element, before `buildProps` runs on exit.
        nodeTransforms: [(node: unknown) => refuseDomOnlyTemplateFeatures(node, filename)],
    };

    const id = scopeId(filename, source);
    // `genDefaultAs` turns `export default {…}` into a binding this module can then
    // attach `render` to, and gives a script with no default export an empty
    // component instead of a syntax error.
    const script = hasScript
        ? compileScript(descriptor, {
              id,
              genDefaultAs: SFC_BINDING,
              // `templateOptions` IS how `runtimeModuleName` reaches this call, and
              // there is no other way in: `compileScript` reads it from
              // `options.templateOptions.compilerOptions.runtimeModuleName` and
              // otherwise emits `import { defineComponent } from 'vue'` — the full
              // Vue package, which re-exports `@vue/runtime-dom` and its DOM
              // renderer into a bundle that has no DOM.
              templateOptions: { compilerOptions },
          })
        : null;

    // Each piece with the map that explains it, so the module can carry ONE map over
    // the whole `.vue` file instead of pointing every stack frame at a generated line.
    const parts: { code: string; map: SourceMapChunkMap | null }[] = [
        script === null
            ? { code: `const ${SFC_BINDING} = {};`, map: null }
            : { code: script.content, map: script.map ?? null },
    ];

    if (descriptor.template !== null) {
        const template = compileTemplate({
            id,
            filename,
            source: descriptor.template.content,
            // Safe to reuse ONLY because `parse` above got the parser options.
            ast: descriptor.template.ast,
            compilerOptions: { ...compilerOptions, bindingMetadata: script?.bindings },
        });
        if (template.errors.length > 0) {
            throw new Error(
                `@gjsify/rolldown-plugin-vue: ${filename} has a template that does not compile:\n  ` +
                    messagesOf(template.errors),
            );
        }
        // The rename is a same-line replacement, so it moves no mapping to another
        // line — and the `export function render(` line the compiler emits carries no
        // mapping of its own.
        parts.push({ code: renameRenderExport(template.code, filename), map: template.map ?? null });
        parts.push({ code: `${SFC_BINDING}.render = ${RENDER_BINDING};`, map: null });
    }

    parts.push({ code: `${SFC_BINDING}.__file = ${JSON.stringify(filename)};`, map: null });
    parts.push({ code: `export default ${SFC_BINDING};`, map: null });

    return {
        code: parts.map((part) => part.code).join('\n'),
        map: combineSourceMaps(parts.map((part) => ({ lineCount: part.code.split('\n').length, map: part.map }))),
    };
}

/**
 * Compile Vue SFCs to a component module for a gjsify custom renderer.
 *
 * Wire it through `package.json#gjsify` so no JS-form config file is needed:
 *
 * ```json
 * "gjsify": { "bundler": { "plugins": [{ "name": "@gjsify/rolldown-plugin-vue" }] } }
 * ```
 */
export function vuePlugin(options: VuePluginOptions = {}): Plugin {
    const isCustomElement = options.isCustomElement ?? isGtkHostTag;
    const include = options.include ?? DEFAULT_INCLUDE;
    const runtimeModuleName = options.runtimeModuleName ?? DEFAULT_RUNTIME_MODULE_NAME;

    return {
        name: 'gjsify-vue',

        resolveId: {
            // Before anything else can claim the specifier — what follows must see
            // the renamed id, not the `.vue` one.
            order: 'pre' as const,
            async handler(source: string, importer: string | undefined) {
                if (!include.test(source)) return null;
                // `skipSelf` so the real resolution runs without re-entering here.
                // The result carries the absolute path; the suffix is appended to
                // THAT, so a diagnostic still names the file with the real path as
                // its prefix.
                const resolved = await this.resolve(source, importer, { skipSelf: true });
                if (!resolved || !include.test(resolved.id)) return null;
                // An EXTERNAL `.vue` is not this plugin's to compile: renaming it would
                // mint a virtual id whose `load` then `readFile`s a path that is not
                // there (ENOENT), for a module the build was told to leave alone. Handed
                // back verbatim instead.
                if (resolved.external) return resolved;
                // `moduleSideEffects` and `meta` are the rest of what the real
                // resolution DECIDED — a plugin that answers with a bare string throws
                // away a `sideEffects: false` and every other plugin's `meta` with it.
                return {
                    id: `${resolved.id}${VIRTUAL_SUFFIX}`,
                    moduleSideEffects: resolved.moduleSideEffects,
                    meta: resolved.meta,
                };
            },
        },

        async load(id: string) {
            if (!id.endsWith(VIRTUAL_SUFFIX)) return null;
            const filename = id.slice(0, -VIRTUAL_SUFFIX.length);
            // Re-checked against `include` rather than against a literal `.vue`, so a
            // caller-narrowed filter stays consistent across the two hooks: the pair
            // that mints an id and the pair that reads it must agree, or the id
            // reaches rolldown's file loader and fails on a path that does not exist.
            if (!include.test(filename)) return null;
            const source = await readFile(filename, 'utf8');
            return compileSfc(source, filename, {
                isCustomElement,
                runtimeModuleName,
                onWarn: (message) => this.warn(message),
            });
        },
    };
}

export default vuePlugin;
