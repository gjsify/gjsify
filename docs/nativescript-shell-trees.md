# Building a window shell from a shared tree (NativeScript)

Moved out of `packages/nativescript-bridge/AGENTS.md`, which is loaded on every agent turn.

**A file's SIBLING roots** (`Adw.AlertDialog dialog { }`, `$Learn learn { }` after the template, ADR 0093 § `sibling-object`) are built in the root's id scope but are no children of it, so `build`/`buildDialog` refuse a tree that has them and `buildWithSiblings` returns `{ root, siblings, objects }` — `objects` being every id, a `Gtk.StackPage` or a dialog included (`getViewById` walks views and cannot reach those, which is why an id on a value object is refused everywhere else). A sibling with no id is refused: nothing could ask for it.

`buildInto(this, tree)` is the class-side half, GTK's `init_template()`: a registered template class builds its own `.blp` into the instance it already is, so the tree that uses `$Toolbar` styles and places it like any widget.

`BuildOptions.translate(text, context)` is how a `_()`-marked string reaches the app's catalog (props, `responses` labels, `strings [ ]` items, breakpoint setters); without it the marking is carried and the text stays as authored.
