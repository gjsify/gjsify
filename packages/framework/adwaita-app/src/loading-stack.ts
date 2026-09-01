// @gjsify/adwaita-app — LoadingStack widget.
// The three-page stack `loadIntoStack` drives (loading / content / error), as a
// ready-made `Gtk.Stack` so consumers don't hand-build the spinner + status
// pages every time. Pair it directly with `loadIntoStack`:
//
//   const stack = new LoadingStack();
//   loadIntoStack({ stack, token, load, fill: (d) => stack.setContent(view(d)) });
//
// Composition-first: it IS a `Gtk.Stack` (the loadIntoStack contract), just
// pre-populated — you can still `add_named`/style it like any stack.
//
// WHY THIS IS STILL ASSEMBLED IN TYPESCRIPT, against the rule the repo now enforces. It was
// converted to a `.blp` and reverted, for two reasons that a template cannot work around:
//
//   · `blueprint-compiler` is not installed on the macOS or Windows runners, and this package
//     builds on all three. A `.blp` here makes the compiler a hard build requirement for every
//     host, not just the ones that ship an app.
//   · The repo BOOTSTRAPS from the published CLI (ADR 0002). Library-mode Blueprint arrives in
//     0.43.0, so during a cold bootstrap the transform does not exist yet and the `.blp` reaches
//     rolldown's JavaScript parser — `using Gtk 4.0;` reads as a `using` declaration with no
//     initializer. The consumer-gate jobs (better-sqlite3, node-gi) failed exactly there.
//
// So the capability is real and its e2e proves it (`tests/e2e/library-blueprint/`); this widget is
// the wrong FIRST consumer. Revisit once 0.43.0 is published and the runners carry the compiler —
// the error title below is untranslatable until then, in every consumer application.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

/**
 * A `Gtk.Stack` pre-wired with the three named pages {@link loadIntoStack}
 * switches between: `loading` (a centered `Adw.Spinner`), `content` (a settable
 * child), and `error` (an `Adw.StatusPage`). Starts on `loading`.
 */
// A `.blp` here needs blueprint-compiler on the macOS + Windows runners and a library-mode
// transform that only exists from 0.43.0, which the cold bootstrap does not have — see the header.
// oxlint-disable-next-line gjsify/prefer-blueprint-template -- measured, see the two lines above
export class LoadingStack extends Gtk.Stack {
    private readonly _content: Adw.Bin;
    private readonly _error: Adw.StatusPage;

    static {
        GObject.registerClass({ GTypeName: 'GjsifyLoadingStack' }, LoadingStack);
    }

    constructor(params: Partial<Gtk.Stack.ConstructorProps> = {}) {
        super(params);

        const loading = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            vexpand: true,
        });
        loading.append(new Adw.Spinner());
        this.add_named(loading, 'loading');

        this._content = new Adw.Bin({ hexpand: true, vexpand: true });
        this.add_named(this._content, 'content');

        this._error = new Adw.StatusPage({
            iconName: 'dialog-error-symbolic',
            // Untranslatable until this widget can carry a `.blp`; the header says what blocks that.
            // oxlint-disable-next-line gjsify/no-literal-widget-label -- see the line above
            title: 'Something went wrong',
        });
        this.add_named(this._error, 'error');

        this.set_visible_child_name('loading');
    }

    /** Set the widget shown on the `content` page. */
    setContent(widget: Gtk.Widget): void {
        this._content.set_child(widget);
    }

    /** Customize the `error` page's title (and optional description). */
    setError(title: string, description?: string): void {
        this._error.set_title(title);
        this._error.set_description(description ?? '');
    }

    /** Show the loading spinner. */
    showLoading(): void {
        this.set_visible_child_name('loading');
    }

    /** Show the content page. */
    showContent(): void {
        this.set_visible_child_name('content');
    }

    /** Show the error page (optionally setting its text first via {@link setError}). */
    showError(): void {
        this.set_visible_child_name('error');
    }
}

GObject.type_ensure(LoadingStack.$gtype);
