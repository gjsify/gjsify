import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Template from './main-window.blp';

/**
 * The application window.
 *
 * Its whole widget tree is declared in `main-window.blp` rather than built here. That is what
 * makes the caption translatable — a string assigned from TypeScript is invisible to `xgettext`,
 * so an interface assembled in code is untranslatABLE while merely looking untranslated.
 */
export class MainWindow extends Gtk.ApplicationWindow {
    declare private _hint: Gtk.Label;

    static {
        GObject.registerClass(
            {
                GTypeName: 'MainWindow',
                Template,
                InternalChildren: ['hint'],
            },
            this,
        );
    }

    constructor(application: Gtk.Application) {
        super({ application });

        // Runtime facts only. Prose belongs in the template, where extraction can see it.
        this._hint.set_label(`${process.platform} · PID ${process.pid}`);
    }
}
