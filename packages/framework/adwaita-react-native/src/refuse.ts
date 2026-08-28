// The named refusal every base module raises, and the audience it is written for.
//
// A widget in this package exists three times: `<name>.gtk.tsx` (the real `Adw.*`
// widget through `@gjsify/gtk-host`), `<name>.native.tsx` (React Native primitives
// over `@gjsify/adwaita-core`'s arithmetic), and `<name>.ts` — this one — which has
// no implementation at all.
//
// WHO REACHES IT. The `exports` map routes `react-native` to the native module and
// `default` to the GTK one, so a tool that honours export conditions never loads a
// base module. Metro does honour them: `metro-config` enables package exports by
// default and `@react-native/metro-config` supplies the `react-native` condition.
// gjsify's own app builds honour them too. What is left is a tool that ignores
// `exports` entirely and falls back to `main`/`module` — and that is exactly the
// case this message is for.
//
// WHY NOT LET IT RESOLVE TO SOMETHING. An earlier draft of this design had the base
// module re-export the React Native implementation, on the theory that half a widget
// beats none. It is the opposite: on GTK the specifier `react-native` is aliased
// onto `@gjsify/react-native`, so an accidentally-loaded native implementation would
// RUN — as a working, worse copy of the widget beside the real one. Invisible in CI,
// obvious on screen. A throw naming the module and the fix is the cheaper failure by
// a wide margin, which is why `scripts/check-adwaita-rn-platform-split.mjs` refuses a
// base module that re-exports a platform sibling.

/** The package's own name, in the message rather than interpolated at five sites. */
const PACKAGE = '@gjsify/adwaita-react-native';

/**
 * Refuse, naming the component and how to reach a real one.
 *
 * Called from the component body rather than at module scope so that a bundler which
 * merely REACHES the base module — a type-only import that survived, a barrel walked
 * for its declarations — does not die at load. The failure is at the first render,
 * which is still long before anything ships.
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
