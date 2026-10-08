// `gi://GLib` answered by the renderer: a timeout that repeats, an idle source, a removal, and an
// absent member (`MainLoop`) refused by name rather than read as `undefined`.
import GLib from 'gi://GLib?version=2.0';

export const kind = typeof GLib.timeout_add;

export async function exercise(): Promise<Record<string, unknown>> {
    let runs = 0;
    let idled = false;
    await new Promise<void>((resolve) => {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            idled = true;
            return GLib.SOURCE_REMOVE;
        });
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
            runs += 1;
            if (runs < 3) return GLib.SOURCE_CONTINUE;
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => GLib.SOURCE_REMOVE);
    const removed = GLib.source_remove(id);
    let refusal = '';
    try {
        void (GLib as unknown as Record<string, unknown>).MainLoop;
    } catch (error) {
        refusal = (error as Error).message;
    }
    return { runs, idled, removed, refusesMainLoop: refusal.includes('MainLoop') };
}
