// Does a GTK runtime bundle carry a GL IMPLEMENTATION — the thing that rasterises — or only the
// dispatch layer that promises one? Split out of the win32 builder so the question is answerable
// in a test without a gvsbuild prefix, a Windows runner or dumpbin; the builder asks it of the
// FINISHED `bin/`, so the answer describes the installed artifact, not the recipe's intent.
//
// #1097: the builder seeded ANGLE (`libEGL`/`libGLESv2`), the patterns matched NOTHING in the
// gvsbuild ZIP, the build stayed green, and four releases shipped `windowing: true` bundles whose
// every `Gtk.GLArea` failed on a host without a vendor OpenGL ICD. A seed that silently matches
// nothing is indistinguishable from one that matched.

/**
 * Filenames that ARE a GL implementation, matched case-insensitively against a bundle's DLL leaf
 * names. Two families satisfy GDK: a desktop-GL ICD over WGL (`opengl32`/`libgallium_wgl` from
 * Mesa's win32 build; `mesadrv.dll` is what `mesa-dist-win` installs a system-wide ICD under),
 * and ANGLE over EGL (`libEGL`/`libGLESv2`).
 *
 * Deliberately NOT here: `epoxy`. libepoxy is the GL *dispatch* layer — it resolves entry points
 * from whatever implementation the OS provides and supplies none itself. Counting it is precisely
 * the misreading that made the bundle look GL-capable, so {@link describeGlImplementation}
 * reports it in its own field.
 */
export const GL_IMPLEMENTATION_PATTERNS = [
    /^opengl32\.dll$/i,
    /^libgallium_wgl\.dll$/i,
    /^mesadrv\.dll$/i,
    /^libEGL.*\.dll$/i,
    /^libGLESv2.*\.dll$/i,
];

/** Filenames that are GL DISPATCH only — present, necessary, and not an implementation. */
export const GL_DISPATCH_PATTERNS = [/^epoxy.*\.dll$/i];

/**
 * Classify a bundle's DLL leaf names into GL implementation vs. GL dispatch.
 *
 * @param {object} options
 * @param {string[]} options.dlls Leaf filenames present in the bundle's `bin/`.
 * @returns {{matched: string[], dispatch: string[], patterns: string[]}} Sorted for a stable
 *   manifest; `patterns` records what was asked, so a consumer holding only the manifest can see
 *   that the negative was checked rather than merely unstated.
 */
export function describeGlImplementation({ dlls }) {
    const sorted = (xs) => [...xs].sort((a, b) => a.localeCompare(b));
    return {
        matched: sorted(dlls.filter((f) => GL_IMPLEMENTATION_PATTERNS.some((re) => re.test(f)))),
        dispatch: sorted(dlls.filter((f) => GL_DISPATCH_PATTERNS.some((re) => re.test(f)))),
        patterns: GL_IMPLEMENTATION_PATTERNS.map(String),
    };
}

/**
 * The message for a windowing bundle that resolves no GL implementation. Names every pattern
 * tried rather than one absent file, so the next unmatched seed cannot reproduce #1097 quietly.
 *
 * @param {object} options
 * @param {ReturnType<typeof describeGlImplementation>} options.gl
 * @param {string} options.prefixBin The `<prefix>/bin` the closure was drawn from.
 */
export function formatMissingGlImplementation({ gl, prefixBin }) {
    const dispatch = gl.dispatch.join(' + ') || 'epoxy';
    return (
        `no GL implementation in this bundle — none of ${gl.patterns.join(', ')} matched anything under ` +
        `${prefixBin}, and ${dispatch} is GL DISPATCH, which resolves nothing on its own. Every Gtk.GLArea will ` +
        'fail with "No GL implementation is available" on a host with no vendor OpenGL ICD (VM, RDP session, CI). ' +
        'Hosts WITH a vendor driver, or with Mesa registered as a system ICD, are unaffected — the implementation ' +
        'comes from the system there. Note that simply bundling one does not close this: gvsbuild libepoxy is built ' +
        'without EGL (so ANGLE cannot be reached), and epoxy loads desktop GL by bare name, which Windows answers ' +
        'from the application directory and System32 but never from PATH. See #1097.'
    );
}
