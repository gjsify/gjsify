// Ambient module for `gi://Gst`, imported only by the real-Spiel spec to build a silent fakesink;
// opaque so no `gi://` specifier leaks into the emitted declarations.
declare module 'gi://Gst?version=1.0' {
    const Gst: unknown;
    export default Gst;
}
