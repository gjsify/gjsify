// `@girs/goa-1.0` declares `gi://Goa?version=1.0` but not the ADR 0087 spelling with the
// `optional` flag, which the bundler resolves to the namespace or `undefined`.
declare module 'gi://Goa?version=1.0&optional' {
    import type Goa from 'gi://Goa?version=1.0';
    const goa: typeof Goa | undefined;
    export default goa;
}
