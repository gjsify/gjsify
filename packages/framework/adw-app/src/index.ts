// Adwaita application bootstrap helper.
// Replaces the 20-line Adw.Application + ApplicationWindow + ToolbarView +
// HeaderBar triplet that every GJS/Adwaita example otherwise repeats inline.
// No manual GLib.MainLoop is needed — Adw.Application.run() quits once the
// last window closes.

import Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';

export interface AdwAppBuildArgs {
    app: Adw.Application;
    window: Adw.ApplicationWindow;
    toolbarView: Adw.ToolbarView;
    headerBar: Adw.HeaderBar;
}

export interface AdwAppOptions {
    /** D-Bus-style reverse-DNS id, e.g. 'io.gjsify.ExampleVideoPlayer'. */
    applicationId: string;
    /** Window title. */
    title: string;
    /** Default width in pixels. Default: 800. */
    defaultWidth?: number;
    /** Default height in pixels. Default: 600. */
    defaultHeight?: number;
    /**
     * Build the window content. Return the root `Gtk.Widget`; it is set as
     * the ToolbarView's content, and the ToolbarView becomes the window's
     * content. Return a `Promise<Gtk.Widget>` to defer `window.present()`
     * until async setup (e.g. `videoBridge.onReady(...)`) resolves.
     */
    build(args: AdwAppBuildArgs): Gtk.Widget | Promise<Gtk.Widget>;
}

/**
 * Create an `Adw.Application`, connect to its `activate` signal with the
 * ApplicationWindow + ToolbarView + HeaderBar boilerplate, and run it.
 * Returns the app's exit code from `Adw.Application.run()`.
 */
export function runAdwApp(opts: AdwAppOptions): number {
    const app = new Adw.Application({ application_id: opts.applicationId });

    app.connect('activate', () => {
        const window = new Adw.ApplicationWindow({ application: app });
        window.set_default_size(opts.defaultWidth ?? 800, opts.defaultHeight ?? 600);
        window.set_title(opts.title);

        const headerBar = new Adw.HeaderBar();
        const toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(headerBar);

        const result = opts.build({ app, window, toolbarView, headerBar });
        const finish = (content: Gtk.Widget): void => {
            toolbarView.set_content(content);
            window.set_content(toolbarView);
            window.present();
        };
        if (result instanceof Promise) {
            result.then(finish, (err) => {
                console.error('[adw-app] build() rejected:', err);
                window.close();
            });
        } else {
            finish(result);
        }
    });

    return app.run([]);
}
