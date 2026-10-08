// ADR 0098: `gi://Gio` answered by the renderer, and an application run to its end. `activate` adds
// the window synchronously (the NativeScript rule), `quit()` ends the run.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

export const kind = typeof Gio.Application;

/** What a run did, read off a live application. */
export async function exercise(): Promise<Record<string, unknown>> {
    const app = new Adw.Application({ application_id: 'org.gjsify.GiArmsProbe' });
    const seen: string[] = [];
    let added: unknown = null;
    app.connect('startup', () => seen.push('startup'));
    app.connect('activate', () => {
        seen.push('activate');
        added = new Adw.ApplicationWindow();
        app.add_window(added as never);
        app.quit();
    });
    const code = await app.runAsync([]);
    return {
        chain: app instanceof Gtk.Application && app instanceof Gio.Application,
        id: app.get_application_id(),
        seen,
        code,
        windowApplication: (added as { application: unknown }).application === null,
    };
}
