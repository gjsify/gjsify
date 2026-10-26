// Ambient module for `gi://Spiel`, the libspiel client library.
//
// fixed upstream in ts-for-gir: replace with @girs/spiel-1.0 once published
//
// Deliberately opaque: the probe's dynamic import is the only place the specifier is
// named, and it narrows the namespace to `SpielNamespace` (`spiel-types.ts`) itself.
// Typing the module here would put a `gi://` specifier into the emitted declarations,
// which a consumer's compiler cannot resolve.
declare module 'gi://Spiel?version=1.0' {
    const Spiel: unknown;
    export default Spiel;
}

// Only the real-Spiel spec imports GStreamer (to build a silent fakesink); opaque for the same reason.
declare module 'gi://Gst?version=1.0' {
    const Gst: unknown;
    export default Gst;
}
