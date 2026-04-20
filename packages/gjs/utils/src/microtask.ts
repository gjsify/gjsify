// Unlike nextTick (GLib.idle_add, lets GTK events interleave), queueMicrotask fires before any GLib source.
export const queueMicrotask = (fn: () => void): void => {
  Promise.resolve().then(fn);
};
