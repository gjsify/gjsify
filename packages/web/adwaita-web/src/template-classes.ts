// The application's own classes, which a `.blp` names with a `$` (ADR 0093): `$SourceView`,
// or `template $MainButton : Adw.Bin` defining one. `SharedTreeNode.extern` says the tag is
// such a class, and this registry is where the shared-tree builder looks it up.
//
// The registry lives here and not in `@gjsify/adwaita-core` because the stored thing is the
// renderer's own: the tag of a custom element the application defines. A name like `Display`
// is not a valid custom-element name and no case rule can invent one, so the caller says which
// tag the class answers to. The application defines the element itself
// (through the custom element registry), which keeps this package's element set the one it ships.

const registry = new Map<string, string>();

/**
 * Registers the custom element `tag` as the class a `.blp` means by `$name`, spelled as the
 * file spells it (`SourceView` for `$SourceView`). The element builds its own internals,
 * typically from its own `.blp?shared-tree`, and must be defined by the time a tree uses it.
 *
 * Registering the same pair again is a no-op; a different tag under the same name is refused,
 * as `Gtk.Builder` refuses a type registered twice.
 */
export function registerTemplateClass(name: string, tag: string): void {
    const known = registry.get(name);
    if (known !== undefined && known !== tag) {
        throw new Error(`the template class '${name}' is already registered as <${known}>.`);
    }
    registry.set(name, tag);
}

/** Whether `tag` is an element an application class registered, whose properties are GObject properties. */
export function isTemplateTag(tag: string): boolean {
    for (const known of registry.values()) if (known === tag) return true;
    return false;
}

/** The tag `name` was registered under, or a refusal that names what is missing. */
export function templateTagFor(name: string): string {
    const tag = registry.get(name);
    if (tag === undefined) {
        throw new Error(
            `the tree uses the class '$${name}', which no registerTemplateClass() call registered: ` +
                'adwaita-web cannot build a class it does not know.',
        );
    }
    if (customElements.get(tag) === undefined) {
        throw new Error(
            `the class '$${name}' is registered as <${tag}>, which nothing has defined in the custom element registry, so ` +
                'the element would stay an empty unknown tag.',
        );
    }
    return tag;
}
