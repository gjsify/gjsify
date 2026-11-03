// `#name` in a GTK stylesheet is the widget NAME (`GtkWidget:name`), a fact separate from the
// `id` a `.blp` gives the same widget so code can find it (`InternalChildren`, `getViewById`).
//
// NativeScript's `#id` selector reads `node.id` and nothing else. The two meet only while the
// widget has no id yet (`widget-layout.ts` writes a name through to `id`), and a template root
// never does: `main-button.blp` says `name: "main-button"`, its parent then says `$MainButton
// mainButton`, and the later id wins. `#main-button` matched nothing, so Learn6502's floating
// action button kept libadwaita's padding. Measured on a Galaxy S9: `id=mainButton`.
//
// So the id selector also matches a node whose `name` is the wanted word. A name is no key in
// NativeScript's id index, so such a rule is filed with the universal ones and tested per node.
// Installed once, on the first name written, so an app that names nothing keeps the stock path.

/** The slice of NativeScript's `IdSelector` the patch touches (`ui/styling/css-selector`). */
export interface IdSelectorClass {
    prototype: {
        id: string;
        match(node: unknown): boolean;
        lookupSort(sorter: { sortAsUniversal(selector: unknown): void }, base?: unknown): void;
    };
}

const INSTALLED = Symbol.for('gjsify.adwaita-nativescript.name-selector');

/** Returns `true` when it patched, `false` when this class already carries the patch. */
export function installNameSelector(IdSelector: IdSelectorClass): boolean {
    const proto = IdSelector.prototype;
    if (Object.hasOwn(proto, INSTALLED)) return false;
    const match = proto.match;
    Object.defineProperty(proto, INSTALLED, { value: true });
    proto.match = function (this: typeof proto, node: unknown): boolean {
        if (match.call(this, node)) return true;
        const name = (node as { name?: unknown } | null)?.name;
        return typeof name === 'string' && name === this.id;
    };
    proto.lookupSort = function (this: typeof proto, sorter, base) {
        sorter.sortAsUniversal(base ?? this);
    };
    return true;
}

let source: (() => IdSelectorClass) | undefined;

/**
 * Where the real class comes from. `platform-host.ts` — the part of the port that already imports
 * `@nativescript/core` for real — registers it, so this module and `widget-layout.ts` stay
 * loadable where there is no NativeScript (the node test entry).
 */
export function provideIdSelector(get: () => IdSelectorClass): void {
    source = get;
}

/** `installNameSelector` on the registered class; a no-op until `platform-host.ts` has loaded. */
export function installProvidedNameSelector(): void {
    if (source !== undefined) installNameSelector(source());
}
