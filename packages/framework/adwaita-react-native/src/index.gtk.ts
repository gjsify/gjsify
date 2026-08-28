// The GTK barrel — `exports["."]`'s `default` condition.
//
// EVERY PLATFORM FILE IS NAMED EXPLICITLY, and this is the correction that made the
// whole package boundary work. The first design resolved the halves by FILE NAME —
// gjsify's `.gtk` chain here, Metro's `.native` step on the phone. Measured against
// `metro-resolver@0.83.5`, that is false for a published library: `resolveSourceFile`
// tries the literal path FIRST, with no platform and an empty source extension, and
// our shipped modules import each other WITH the `.js` extension. Metro finds
// `clamp.js` and never looks at `clamp.native.js`. `.native` wins only for
// extensionless specifiers, which a `lib/esm` build does not emit.
//
// So the fork happens once, at the package boundary, through `exports` conditions —
// and inside the package every import is unconditional and literal. Both mechanisms
// still exist and are still useful to APPLICATIONS; neither carries this library.

export type { AdwBinProps, AdwClampProps, AdwWidgetProps } from './props.js';

export { AdwBin } from './widgets/bin.gtk.js';
export { AdwClamp } from './widgets/clamp.gtk.js';
