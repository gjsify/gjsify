// The React Native barrel — `exports["."]`'s `react-native` condition.
//
// A stock React Native 0.87 application reaches this file with no configuration, and
// this was measured by resolving a package of this exact shape through the real
// resolver rather than read off a changelog: `metro-config@0.87.0`
// `defaults/index.js:69` sets `unstable_enablePackageExports: true` (line 65 leaves
// `unstable_conditionNames` EMPTY, so metro alone would take the `default` branch), and
// `@react-native/metro-config@0.87.1` `dist/index.js:49` supplies
// `unstable_conditionNames: ['react-native']`. It is the React Native preset, not metro,
// that selects this half.
//
// The naming rule and the measurement that forced it are in `index.gtk.ts`.

export type { AdwBinProps, AdwClampProps, AdwWidgetProps } from './props.js';

export { AdwBin } from './widgets/bin.native.js';
export { AdwClamp } from './widgets/clamp.native.js';
