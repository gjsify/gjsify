// Hand-written ambient module for `gi://GjsifyGamepad`, the @gjsify/gamepad-native shim.
//
// Deliberately opaque: the probe's dynamic import is the only place the specifier is
// named, and it narrows the namespace to `GjsifyGamepadNamespace` (`sdl-namespace.ts`)
// itself. Typing the module here instead would put a `gi://` specifier into this
// package's emitted declarations, which a consumer's compiler cannot resolve.
declare module 'gi://GjsifyGamepad?version=1.0' {
    const GjsifyGamepad: unknown;
    export default GjsifyGamepad;
}
