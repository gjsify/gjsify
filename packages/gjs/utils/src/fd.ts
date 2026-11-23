import GioUnix from '@girs/giounix-2.0';

// Its own subpath (`@gjsify/utils/fd`) and NOT part of the root barrel: the
// barrel is reached by `nativescript`-resolved polyfills (`@gjsify/os`, `@gjsify/fs`),
// and a barrel-level `gi://GioUnix` import fails the NativeScript `giRenderer`
// build ("gi://GioUnix has no widget renderer") even though nothing calls it.

/** Is `fd` open? Probed by wrapping it, as GLib has no file-descriptor test. */
export const existsFD = (fd: number) => {
    try {
        const stream = GioUnix.InputStream.new(fd, false);
        stream.close(null);
        return true;
    } catch (_error) {
        // The throw IS the answer: an unusable fd cannot be wrapped.
        return false;
    }
};
