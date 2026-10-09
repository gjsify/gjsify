// `GtkSource.init()` registers GtkSourceView's types and resolves its data directories. This port
// has neither to do, and GJS holds the same shape: it returns `undefined` and a second call is
// harmless, so a shared source can call it first without a platform branch.
//
// A file of its own so a spec can import it without the widget classes, which need
// `@nativescript/core` at module scope.
export function init(): void {}
