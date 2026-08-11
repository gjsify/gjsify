// Fires before any GLib source, unlike nextTick, which goes through the GLib main
// context so GTK events can interleave (see ./next-tick.ts).
export const queueMicrotask = (fn: () => void): void => {
    Promise.resolve().then(fn);
};
