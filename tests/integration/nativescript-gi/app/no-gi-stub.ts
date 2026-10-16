// `@gjsify/node-gi/gi` REPLACED — the "no plugin in the bundle" variant of ADR 0110 gate 2.
//
// `GJSIFY_GI_PLUGIN=0` aliases the bridge to this file (see ../vite.config.ts). It exists because
// of the finding stage 4 wrote down: importing `@gjsify/node-gi` used to load the native library
// whether or not the app opts in. The NativeScript host loads it lazily now, so the control run
// that keeps the import (`GJSIFY_GI_OPT_IN=0`) maps nothing either; this stub stays as the rung
// that leaves the bridge out of the bundle altogether (B0), so the two can be compared, and it
// is produced without a second copy of `app/opt-in.ts`.
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
