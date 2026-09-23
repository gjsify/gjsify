// The Web Components and NativeScript panes of a one-Blueprint gallery block, composed from
// three parts: the layout in the port's own markup, GENERATED from the block's `.blp`; the
// element-access code the page writes by hand in the `webloader` / `nativescriptloader` slot;
// and the Blueprint route, commented, generated from the file name.
//
// MARKUP FIRST because that is what a reader of these tabs came for: how a widget is written
// in this port — an attribute on `<gtk-label wrap>`, a property on `<gtk:Label>`. Loading the
// `.blp` instead is one import and one call, so it is the note at the end. The markup is never
// written into a page: `@gjsify/adwaita-core/markup` renders it from the projection on every
// build, which is what keeps it from being a second copy of the layout.
//
// ONE FENCE PER PANE, so each stays one file a reader can copy. The web pane is an HTML page:
// the markup, then a module script running the slot's code. The NativeScript pane is the XML
// template, with the TypeScript that loads it in an XML comment after the root element —
// NativeScript keeps a template and its code in two files, one fence holds one language, and
// the XML is what this tab exists to show. A comment after the root keeps the fence a template
// NativeScript loads as it stands; a TypeScript fence carrying the XML in a string would not be.
//
// PLAIN JS, in its own file, for the reason `attr-sample.mjs` gives: `AdwWidget.astro` is not
// linted, and `scripts/check-website-blueprint-markup.mjs` composes the same panes from the
// page's slots and holds the built site to them, so the two cannot compose differently.

/** The two panes this module composes, by the slot that supplies the access code. */
export const BLUEPRINT_PANE_SLOTS = {
    webloader: { lang: 'html', accessLang: 'js' },
    nativescriptloader: { lang: 'xml', accessLang: 'ts' },
};

const indent = (lines) => lines.map((line) => (line === '' ? '' : `  ${line}`));

/** `AdwClamp` -> `Adw.Clamp`, the type a NativeScript author casts a built root to. */
const typeNameOf = (tag) => tag.replace(/^(Adw|Gtk)/, '$1.');

/**
 * Refuses an access fence written in the retired shape — a whole Blueprint program, importing
 * the `.blp` — because the Blueprint route is now generated after it and the page would show
 * it twice.
 */
function refuseBlueprintProgram(slot, access) {
    if (!access.includes('?shared-tree')) return;
    throw new Error(
        `the "${slot}" slot imports a \`?shared-tree\`. It holds only the code that reaches the elements ` +
            'by id now: the markup and the commented Blueprint route are generated from the `.blp`. ' +
            'Drop the imports of the file and of the builder, and bind the root from the markup ' +
            "(`document.querySelector('#…')`, `Builder.load(…)`).",
    );
}

/**
 * The Web Components pane: `markup`, then a module script with `access` and the commented
 * `mountSharedTree` route for `file` (the `.blp`'s name beside the page).
 */
export function webComponentsPane({ markup, access, file }) {
    refuseBlueprintProgram('webloader', access);
    // Inline, `</script` ends the element, whatever JS context it sits in.
    if (/<\/script/i.test(access)) throw new Error('the "webloader" slot contains `</script`, which ends the script.');
    const blueprint = [
        '// Or build the same layout from the Blueprint instead of the markup above:',
        "// import { mountSharedTree } from '@gjsify/adwaita-web';",
        `// import tree from './${file}?shared-tree';`,
        '// mountSharedTree(tree);',
    ];
    const body = [...access.trimEnd().split('\n'), '', ...blueprint];
    return [markup, '<script type="module">', ...indent(body), '</script>'].join('\n');
}

/**
 * The NativeScript pane: the XML template `markup`, then an XML comment holding `access` and
 * the `build` route for `file`, which binds the root under the tree's own id — the name the
 * access code binds it under too.
 */
export function nativeScriptPane({ markup, access, file, tree }) {
    refuseBlueprintProgram('nativescriptloader', access);
    // XML forbids `--` inside a comment, so code holding one would end the template early.
    if (access.includes('--'))
        throw new Error('the "nativescriptloader" slot contains `--`, which no XML comment may.');
    const root = tree.id ?? 'root';
    const body = [
        'In TypeScript:',
        '',
        ...access.trimEnd().split('\n'),
        '',
        'Or build the same layout from the Blueprint instead of this XML:',
        '',
        "import { build } from '@gjsify/adwaita-nativescript/builder';",
        `import tree from './${file}?shared-tree';`,
        `const ${root} = build(tree) as ${typeNameOf(tree.tag)};`,
    ];
    return [markup, '<!--', ...indent(body), '-->'].join('\n');
}
