/**
 * Node.js module loader hook that stubs @girs/* imports with empty modules.
 * These packages provide GJS (GNOME JavaScript) bindings that are not
 * available on Node.js. Used only for running tests on Node.js.
 *
 * Usage: node --import ./gjs-stub-loader.mjs test.node.mjs
 */
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@girs/')) {
        return { url: 'data:text/javascript,export default {}', shortCircuit: true };
    }
    if (specifier.startsWith('@gjsify/gio-2.0') || specifier.startsWith('@gjsify/soup-3.0')) {
        return { url: 'data:text/javascript,export default {}', shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
`), import.meta.url);
