// The named refusal every base module raises. A widget exists three times: the real
// `Adw.*` in `<name>.gtk.tsx`, React Native primitives over `@gjsify/adwaita-core`'s
// arithmetic in `<name>.native.tsx`, and `<name>.ts` — this function's caller — with no
// implementation at all.
//
// WHO REACHES IT is narrower than "a tool that ignores export conditions", and the
// measurements say so. Metro honours them, and gjsify's own builds resolve past the base
// file before the bundler sees it. Node honours `exports` whenever it is present, and
// metro with package exports switched OFF reads `['browser', 'main']`, neither of which
// this package declares — it fails to resolve rather than landing here. What is left is a
// bundler that ignores `exports` and reads `module`, and that is this message's audience.
//
// WHY IT THROWS INSTEAD OF RESOLVING TO SOMETHING. On the GTK path the specifier
// `react-native` is aliased onto `@gjsify/react-native`, so a base module re-exporting the
// native implementation would RUN — a working, worse copy of the widget beside the real
// one, invisible in CI and obvious on screen. A throw naming the module and the fix is the
// cheaper failure by a wide margin; `scripts/check-adwaita-rn-platform-split.mjs` rule 3
// enforces it and carries the full account.

/** The package's own name, in the message rather than interpolated at five sites. */
const PACKAGE = '@gjsify/adwaita-react-native';

/**
 * Refuse, naming the component and how to reach a real one.
 *
 * Called from the component body rather than at module scope so that a bundler which
 * merely REACHES the base module — a type-only import that survived, a barrel walked for
 * its declarations — does not die at load. The failure is at the first render, which is
 * still long before anything ships.
 */
export function refuseBaseModule(component: string): never {
    throw new Error(
        `${PACKAGE}: <${component}> was loaded from the BASE module, which has no implementation. ` +
            `The two real ones are selected by the package's \`exports\` map — the \`react-native\` ` +
            `condition picks the React Native build, anything else picks the GTK build. ` +
            `Reaching this module means the tool that resolved ${PACKAGE} ignored export conditions. ` +
            `For Metro, that is \`unstable_enablePackageExports\` (on by default since metro-config 0.83) ` +
            `plus \`unstable_conditionNames: ['react-native']\` (set by @react-native/metro-config); ` +
            `for anything else, import the platform module directly.`,
    );
}
