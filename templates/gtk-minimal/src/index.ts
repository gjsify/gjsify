import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';

const app = new Gtk.Application({
    applicationId: 'org.gjsify.example',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({
        application: app,
        title: 'new-gjsify-app',
        defaultWidth: 480,
        defaultHeight: 280,
    });

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        marginTop: 24,
        marginBottom: 24,
        marginStart: 24,
        marginEnd: 24,
    });

    const title = new Gtk.Label({ label: 'Hello from gjsify!' });
    title.add_css_class('title-2');

    const hint = new Gtk.Label({
        label: `Running on ${process.platform} · PID ${process.pid}`,
        xalign: 0.5,
    });

    box.append(title);
    box.append(hint);
    window.set_child(box);
    window.present();
});

app.run([]);
