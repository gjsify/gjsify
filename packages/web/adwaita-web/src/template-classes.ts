// The application's own classes, which a `.blp` names with a `$` (ADR 0093): `$SourceView`,
// or `template $MainButton : Adw.Bin` defining one. `SharedTreeNode.extern` says the tag is
// such a class, and this registry is where the shared-tree builder looks it up.
//
// The registry lives here and not in `@gjsify/adwaita-core` because the stored thing is the
// renderer's own: a custom-element class, together with the tag it is defined under. A name
// like `Display` is not a valid custom-element name and no case rule can invent one, so the
// caller says which tag the class answers to.

interface TemplateClass {
    ctor: CustomElementConstructor;
    tag: string;
}

const registry = new Map<string, TemplateClass>();

/**
 * Registers `ctor` as the class a `.blp` means by `$name` (the name as the file spells it:
 * `SourceView` for `$SourceView`), defined as the custom element `tag`.
 *
 * Registering the same class again is a no-op; a different class under the same name, or a
 * tag already defined as another class, is refused as `Gtk.Builder` refuses a type twice.
 */
export function registerTemplateClass(name: string, ctor: CustomElementConstructor, tag: string): void {
    const known = registry.get(name);
    if (known !== undefined) {
        if (known.ctor === ctor && known.tag === tag) return;
        throw new Error(`the template class '${name}' is already registered as <${known.tag}>.`);
    }
    const defined = customElements.get(tag);
    if (defined === undefined) customElements.define(tag, ctor);
    else if (defined !== ctor) {
        throw new Error(`<${tag}> is already defined as another class, so '${name}' cannot be registered under it.`);
    }
    registry.set(name, { ctor, tag });
}

/** The tag `name` was registered under, or a refusal that names it. */
export function templateTagFor(name: string): string {
    const found = registry.get(name);
    if (found === undefined) {
        throw new Error(
            `the tree uses the class '$${name}', which no registerTemplateClass() call registered: ` +
                'adwaita-web cannot build a class it does not know.',
        );
    }
    return found.tag;
}
