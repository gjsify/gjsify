// `@gjsify/node-gi/gi` REPLACED — the "no plugin in the bundle" variant of ADR 0110 gate 2.
//
// `GJSIFY_GI_PLUGIN=0` aliases the bridge to this file (see ../vite.config.ts). It exists because
// of the finding stage 4 wrote down: importing `@gjsify/node-gi` loads the native library whether
// or not the app opts in — its module body runs `loadNativeHost()`. So the control run that keeps
// the import (`GJSIFY_GI_OPT_IN=0`) still `dlopen`s `libnode_gi.so` and its whole closure, and it
// therefore cannot answer "what does an app that does NOT want real GObject pay". An app that
// wants the pure-JS path to cost nothing must not import the bridge at all, and this stub is how
// that build is produced without a second copy of `app/opt-in.ts`.
//
// It is a stub and not an empty module: `app/opt-in.ts` re-exports `requireGi`, and a specifier
// that resolved to nothing would be a build error rather than a variant. Nothing calls it — every
// caller is behind `optedIn`, which this variant forces false — and if something ever did, the
// throw names the build rather than failing as a missing symbol somewhere inside GI.
const requireGi = (namespace: string, version?: string): never => {
    throw new Error(
        `@gjsify/node-gi is not in this build: cannot require ${namespace}${version ? `-${version}` : ''}. ` +
            'This APK was bundled with GJSIFY_GI_PLUGIN=0, which stubs the bridge out so that nothing ' +
            'dlopens libnode_gi.so. Rebuild without that flag to reach real GObject.',
    );
};

export default requireGi;
