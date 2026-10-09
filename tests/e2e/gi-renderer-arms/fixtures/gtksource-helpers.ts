// The helpers Learn6502's source view reads from `gi://GLib`, `gi://Gio` and `gi://Adw`, answered by the
// renderer: the path functions, a `SimpleActionGroup` that activates, `Adw.StyleManager.get_default()` and
// its `dark`, and an absent member (`GLib.get_home_dir`) refused by name.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

export const kind = typeof GLib.build_filenamev;

export async function exercise(): Promise<Record<string, unknown>> {
    const ran: string[] = [];
    const group = new Gio.SimpleActionGroup();
    const action = new Gio.SimpleAction({ name: 'copy' });
    action.connect('activate', () => void ran.push('copy'));
    group.add_action(action);
    group.activate_action('copy', null);

    const manager = Adw.StyleManager.get_default();
    let refusal = '';
    try {
        void (GLib as unknown as Record<string, unknown>).get_home_dir;
    } catch (error) {
        refusal = (error as Error).message;
    }
    return {
        joined: GLib.build_filenamev(['a/', '/b', 'c']),
        max: GLib.MAXUINT32,
        dirs: [typeof GLib.get_current_dir(), Array.isArray(GLib.get_system_data_dirs())],
        ran,
        sameManager: manager === Adw.StyleManager.get_default(),
        dark: typeof manager.get_dark(),
        refusesHomeDir: refusal.includes('get_home_dir'),
    };
}
