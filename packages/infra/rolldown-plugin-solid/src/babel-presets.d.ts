// Neither preset ships type declarations, and `@types/*` packages for them do
// not exist. Declaring the default export as `unknown` is EXACT rather than a
// workaround: this plugin never calls into either preset, it only hands them to
// Babel, so any shape beyond "a value" would be invented. A bare
// `declare module 'x';` would type them as `any` and take the check with it.
declare module 'babel-preset-solid' {
    const preset: unknown;
    export default preset;
}

declare module '@babel/preset-typescript' {
    const preset: unknown;
    export default preset;
}
