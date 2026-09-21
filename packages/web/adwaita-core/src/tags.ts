// The two case rules an authored `SharedTreeNode` (ADR 0051, `./conformance`) is turned
// into markup with — published here so a markup-based tree BUILDER can depend on them
// without depending on `scripts/`, which cannot ship inside an npm package at all.
//
// WHY HERE. Renderer-free and Tier 2 (ADR 0003), like the rest of this package, and already
// on the dependency every renderer's tree driver carries for `@gjsify/adwaita-core/conformance`
// — a `./tags` subpath adds no new edge. `@gjsify/gtk-host` (Tier 3) needing these too is not
// a reason to publish them any lower: a Tier-2 target is reachable from Tier 2
// (`@gjsify/adwaita-web`) and Tier 3 (`gtk-host`) alike, while putting them IN `gtk-host`
// would put a Tier-3 package on `adwaita-web`'s import graph — the edge ADR 0003 already
// refuses in the other direction.
//
// THE RESTATEMENT `scripts/` STILL CARRIES. `scripts/adwaita-gallery-shared-trees.mjs` needs
// both functions too, and its readers — the gallery generators and
// `check-generated-website-data.mjs` — run in the `audit-runtimes.yml` `check` /
// `check-windows` jobs, which install nothing on purpose (`checkout` + `setup-node`, no
// `yarn install`). A bare `@gjsify/adwaita-core` specifier does not resolve there, so that
// file keeps its own copy rather than importing this one — restated, not owned, and held
// identical to THIS file by `scripts/check-tag-case-rules.mjs`, the same shape
// `scripts/check-shared-tree-shape.mjs` already uses for `SharedTreeNode` itself: an original
// that decides the rule, and a copy that says why it cannot import it and is machine-held to
// match.
//
// `hostTagOf` mirrors `gtk-host`'s OWN case rule (`tagOf` in
// `packages/framework/gtk-host/src/tags.ts`) rather than importing it, for the identical
// reason: `gtk-host` is Tier 3, so this package cannot depend on it either. That pair is
// unaffected by this move — `scripts/check-generated-website-data.mjs` arm 11 still holds
// the `scripts/` copy against every row of `gtk-host`'s own generated table.

/**
 * `AdwPreferencesGroup` -> `adw-preferences-group`.
 *
 * THE RULE: the last capital of an acronym run opens the next word, which is why `GLArea`
 * is `gl-area` and not `g-l-area`. The first version of this function was a naive
 * `([a-z0-9])([A-Z])` split, and `GtkGLArea` caught it — it produced `gtk-glarea` where
 * `gtk-host` stamps `gtk-gl-area`, which is why arm 11 of `check-generated-website-data.mjs`
 * holds the `scripts/` restatement against every row of the generated table rather than
 * against a handful of tags a corpus happens to use today.
 *
 * NOT AN INVERSE OF ANYTHING. Tag -> GType is lossy in exactly that case — `gtk-gl-area`
 * reads back as `GtkGlArea` and no case rule can know better — so a reverse lookup has to be
 * a table read backwards, never a second rule.
 */
export const hostTagOf = (gtype: string) => {
    if (!/^(?:Adw|Gtk)[A-Z]\w*$/.test(gtype)) {
        throw new Error(`hostTagOf: ${gtype} is not a GIR class name`);
    }
    const out = [];
    for (let i = 0; i < gtype.length; i++) {
        const c = gtype.charAt(i);
        if (c >= 'A' && c <= 'Z' && i > 0) {
            const prev = gtype.charAt(i - 1);
            const next = gtype.charAt(i + 1);
            const endsLowerRun = !(prev >= 'A' && prev <= 'Z');
            const endsAcronym = next >= 'a' && next <= 'z';
            if (endsLowerRun || endsAcronym) out.push('-');
        }
        out.push(c.toLowerCase());
    }
    return out.join('');
};

/**
 * `buttonLabel` -> `button-label`.
 *
 * NOT AN ALIAS TABLE and not a second transform beside {@link hostTagOf}: a case rule over
 * the authored property NAME, with no entry to give a name it does not recognise. A markup
 * renderer's tree builder turns an authored prop into a DOM attribute with this rule, and
 * arm 13 of `check-generated-website-data.mjs` reads a gallery fence's attributes back
 * through the `scripts/` restatement of it, so the two stay one spelling rather than two.
 */
export const attributeOf = (prop: string) => prop.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);
