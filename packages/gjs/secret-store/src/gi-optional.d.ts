// `@girs/secret-1` declares `gi://Secret?version=1` but not the ADR 0087 spelling with the
// `optional` flag, which the bundler resolves to the namespace or `undefined`.
declare module 'gi://Secret?version=1&optional' {
    import type Secret from 'gi://Secret?version=1';
    const secret: typeof Secret | undefined;
    export default secret;
}
