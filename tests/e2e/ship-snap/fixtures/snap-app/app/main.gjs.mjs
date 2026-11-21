// The payload, hand-written and therefore SOURCE — this fixture has no build step.
//
// `ship-stage` in `.github/workflows/main.yml` stages it with `--skip-build`, and
// `ship-pack-snap` packs it with the real snapcraft. `@gjsify/cli` cannot stand in:
// it is a terminal tool with no desktop entry, and a snap built on the `gnome`
// extension points its `desktop:` key at one. The first line goes out before any
// display is requested, so a runner without one still shows whether the snap's
// launcher reached `gjs` and which GTK the platform snap provided.
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import system from 'system';

print(
    `ship-snap-demo: gjs ${system.version}, GTK ${Gtk.get_major_version()}.${Gtk.get_minor_version()}.${Gtk.get_micro_version()}, ` +
        `GLib ${GLib.MAJOR_VERSION}.${GLib.MINOR_VERSION}, SNAP=${GLib.getenv('SNAP') ?? '-'}`,
);

const app = new Adw.Application({ application_id: 'eu.jumplink.ShipSnapDemo' });
app.connect('activate', () => {
    new Adw.ApplicationWindow({ application: app, title: 'Ship Snap Demo' }).present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        app.quit();
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
