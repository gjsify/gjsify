// The application's own classes, which a `.blp` names with a `$` (ADR 0093): `$SourceView`, or
// `template $MainButton : Adw.Bin` defining one. `SharedTreeNode.extern` says the tag is such a
// class, and this registry is where the shared-tree builder looks it up.
//
// Pure data and no `@nativescript/core` import, like the rest of what a tool may read: the class
// stored is the application's `View` constructor and this module never has to name `View`.

/** What the builder constructs: no arguments for a widget, a construct bag for a value object. */
export type TemplateClass = new (props?: Record<string, unknown>) => object;

const registry = new Map<string, TemplateClass>();

/**
 * Registers `ctor` as the class a `.blp` means by `$name`, spelled as the file spells it
 * (`SourceView` for `$SourceView`). The class builds its own internals, typically from its own
 * `.blp?shared-tree`.
 *
 * Registering the same class again is a no-op; a different class under the same name is
 * refused, as `Gtk.Builder` refuses a type registered twice.
 */
export function registerTemplateClass(name: string, ctor: TemplateClass): void {
    const known = registry.get(name);
    if (known !== undefined && known !== ctor) {
        throw new Error(`the template class '${name}' is already registered as another class.`);
    }
    registry.set(name, ctor);
}

/** The class registered under `name`, or a refusal that names it. */
export function templateClassFor(name: string): TemplateClass {
    const found = registry.get(name);
    if (found === undefined) {
        throw new Error(
            `the tree uses the class '$${name}', which no registerTemplateClass() call registered: ` +
                'adwaita-nativescript cannot build a class it does not know.',
        );
    }
    return found;
}
