// The FILES of the Web Components and NativeScript tabs of a one-Blueprint gallery block, each
// composed from up to three parts: the layout in the port's own markup, GENERATED from the
// block's `.blp`; the element-access code the page writes by hand in the `webloader` /
// `nativescriptloader` slot; and the Blueprint route, generated from the file name.
//
// ONE FILE PER VIEW, AS A PROJECT HOLDS THEM. The markup, the code that loads it and the
// Blueprint route used to share one fence per tab, the second language carried in a comment of
// the first: TypeScript inside an XML comment, the Blueprint route commented out in a script.
// Unhighlighted, it read as dead code, and a reader copying the tab got a file no project has.
// So each tab is a list of files now, each highlighted in its own language and copied on its
// own, named the way a project names them:
//
//   Web Components  index.html           the markup, then a module script running the slot code
//                   main.js (Blueprint)  `mountSharedTree` of the `.blp`, then the same slot code
//   NativeScript    views/<name>.xml     the template, which `Builder.load` finds under `~/views`
//                   app.ts               the slot code as written: `Builder.load`, then ids
//                   app.ts (Blueprint)   the slot code with `build(tree)` in place of the load
//
// `main.js` and not `main.ts`: the slot is a JavaScript fence, and `querySelector` hands back
// an `Element` that TypeScript would refuse a `.label` on. `app.ts` and not `views/<name>.ts`:
// NativeScript loads `views/<name>.ts` as the template's code-behind WHILE loading the template,
// so a code-behind calling `Builder.load` on its own template would load itself.
//
// THE BLUEPRINT FILES ARE THE SLOT CODE, REWRITTEN, and the rewrite is strict: one line of the
// slot says how the layout is reached — the bare `import '@gjsify/adwaita-web'` that defines
// the elements the markup uses, the `Builder.load(…)` that inflates the template — and exactly
// that line is replaced by the Blueprint route. A slot without it is refused, because the file
// would then show a route beside code that never used it.
//
// PLAIN JS, in its own file, for the reason `attr-sample.mjs` gives: `AdwWidget.astro` is not
// linted, and `scripts/check-website-blueprint-markup.mjs` composes the same files from the
// page's slots and holds the built site to them, so the two cannot compose differently.

/** The fence language of each slot's access code. */
export const BLUEPRINT_PANE_SLOTS = {
    webloader: { accessLang: 'js' },
    nativescriptloader: { accessLang: 'ts' },
};

const indent = (lines) => lines.map((line) => (line === '' ? '' : `  ${line}`));

/** `AdwClamp` -> `Adw.Clamp`, the type a NativeScript author casts a built root to. */
const typeNameOf = (tag) => tag.replace(/^(Adw|Gtk)/, '$1.');

/**
 * Refuses an access fence written in the retired shape — a whole Blueprint program, importing
 * the `.blp` — because the Blueprint route is a generated file of its own and the page would
 * show it twice.
 */
function refuseBlueprintProgram(slot, access) {
    if (!access.includes('?shared-tree')) return;
    throw new Error(
        `the "${slot}" slot imports a \`?shared-tree\`. It holds only the code that reaches the elements ` +
            'by id now: the markup and the Blueprint route are generated from the `.blp`. ' +
            'Drop the imports of the file and of the builder, and bind the root from the markup ' +
            "(`document.querySelector('#…')`, `Builder.load(…)`).",
    );
}

/** The index of the one line of `lines` that `test` accepts, or an error naming the slot. */
function theLine(slot, lines, test, what) {
    const found = lines.flatMap((line, at) => (test(line) ? [at] : []));
    if (found.length !== 1) {
        throw new Error(
            `the "${slot}" slot has ${found.length} lines that ${what}, and needs exactly one: the ` +
                'Blueprint file of its tab is that code with that line replaced by the Blueprint route.',
        );
    }
    return found[0];
}

/**
 * The Web Components files: `index.html` (the `markup`, then a module script with `access`) and
 * `main.js`, where `access`'s bare `import '@gjsify/adwaita-web'` becomes `mountSharedTree` of
 * `file`, the `.blp`'s name beside the page.
 */
export function webComponentsFiles({ markup, access, file }) {
    refuseBlueprintProgram('webloader', access);
    // Inline, `</script` ends the element, whatever JS context it sits in.
    if (/<\/script/i.test(access)) throw new Error('the "webloader" slot contains `</script`, which ends the script.');
    const lines = access.trimEnd().split('\n');
    const define = theLine(
        'webloader',
        lines,
        (line) => /^import\s+'@gjsify\/adwaita-web';$/.test(line),
        "import '@gjsify/adwaita-web' for its side effect",
    );
    // After the last import, so the tree is in the document before the first id is looked up.
    const lastImport = lines.findLastIndex((line) => /^import\s/.test(line));
    const blueprint = [
        ...lines.slice(0, define),
        "import { mountSharedTree } from '@gjsify/adwaita-web';",
        `import tree from './${file}?shared-tree';`,
        ...lines.slice(define + 1, lastImport + 1),
        '',
        'mountSharedTree(tree);',
        ...lines.slice(lastImport + 1),
    ];
    return [
        {
            role: 'markup',
            label: 'index.html',
            lang: 'html',
            source: [markup, '<script type="module">', ...indent(lines), '</script>'].join('\n'),
        },
        { role: 'blueprint', label: 'main.js (Blueprint)', lang: 'js', source: blueprint.join('\n') },
    ];
}

/** `const <name> = Builder.load({ path: '~/views', name: '<view>' }) as <Type>;` */
const BUILDER_LOAD = /^(const|let) (\w+) = Builder\.load\(\{ path: '~\/views', name: '([^']+)' \}\)( as [\w.]+)?;$/;
const BUILDER_IMPORT = /^import \{ Builder \} from '@nativescript\/core';$/;

/**
 * The NativeScript files: the XML template `markup` as `views/<name>.xml`, `access` as `app.ts`,
 * and `app.ts` again with its `Builder.load(…)` replaced by `build` of `file`'s tree, bound to
 * the same name and cast as the load was (to the root's type where the load had no cast).
 */
export function nativeScriptFiles({ markup, access, file, tree }) {
    refuseBlueprintProgram('nativescriptloader', access);
    const view = file.replace(/\.blp$/, '');
    const lines = access.trimEnd().split('\n');
    const load = theLine('nativescriptloader', lines, (line) => /\bBuilder\.load\(/.test(line), 'call Builder.load(…)');
    const bound = BUILDER_LOAD.exec(lines[load]);
    if (bound === null) {
        throw new Error(
            `the "nativescriptloader" slot loads the template as \`${lines[load].trim()}\`. Write it as ` +
                `\`const <root> = Builder.load({ path: '~/views', name: '${view}' }) as <Type>;\`, the one ` +
                'shape its Blueprint file can replace.',
        );
    }
    if (bound[3] !== view) {
        throw new Error(
            `the "nativescriptloader" slot loads the view "${bound[3]}", and the template is generated as ` +
                `views/${view}.xml from ${file}. Load it as name: '${view}'.`,
        );
    }
    // The `Builder` import has no use left once the load is gone, so the Blueprint imports take
    // its place.
    const imports = theLine(
        'nativescriptloader',
        lines,
        (line) => BUILDER_IMPORT.test(line),
        "import { Builder } from '@nativescript/core'",
    );
    const blueprint = lines.flatMap((line, at) => {
        if (at === imports) {
            return [
                "import { build } from '@gjsify/adwaita-nativescript/builder';",
                `import tree from './${file}?shared-tree';`,
            ];
        }
        if (at === load) return [`${bound[1]} ${bound[2]} = build(tree)${bound[4] ?? ` as ${typeNameOf(tree.tag)}`};`];
        return [line];
    });
    return [
        { role: 'markup', label: `views/${view}.xml`, lang: 'xml', source: markup },
        { role: 'code', label: 'app.ts', lang: 'ts', source: lines.join('\n') },
        { role: 'blueprint', label: 'app.ts (Blueprint)', lang: 'ts', source: blueprint.join('\n') },
    ];
}

/** Each loader slot's file composer. */
export const BLUEPRINT_PANE_FILES = {
    webloader: webComponentsFiles,
    nativescriptloader: nativeScriptFiles,
};
