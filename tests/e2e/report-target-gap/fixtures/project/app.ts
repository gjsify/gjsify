// Read as DATA by `scripts/report-target-gap.mjs`, never built or run.
//
// Gtk.Button is named in this comment and in the string below, and must not count as a use.
import GObject from 'gi://GObject?version=2.0';
import Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';

const prose = 'Gtk.Button';

export class Fixture extends Adw.Window implements Gtk.Buildable {
    static {
        GObject.registerClass(this);
    }

    // `GObject.ParamSpec` is only a type here: it needs nothing from a renderer at run time.
    private spec: GObject.ParamSpec | null = null;

    run(): Adw.NoSuchMemberForTheReport | Gtk.Label {
        return Adw.NoSuchMemberForTheReport(prose, Adw.NoSuchMemberForTheReport);
    }
}
