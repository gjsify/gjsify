// The BASE barrel — the entry a tool reaches when it ignores export conditions.
//
// `package.json`'s `module`/`main` point here, and `exports["."]` does not: the
// `react-native` condition routes to `./index.native.js` and `default` to
// `./index.gtk.js`. So this file is what a resolver without export-condition support
// loads, and everything it re-exports refuses at first render with a message naming
// that resolver as the cause (`refuse.ts`).
//
// IT RE-EXPORTS THE BASE MODULES, NEVER A PLATFORM SIBLING. That rule is what
// `scripts/check-adwaita-rn-platform-split.mjs` enforces, and it is the whole
// difference between a loud refusal and a working worse copy of the widget.
//
// It is also the package's TYPE authority: `lib/types/index.d.ts` is generated from
// here and is what `exports["."].types` names, so both platform builds are described
// to consumers by one declaration. `parity.spec.ts` is what makes that true rather
// than merely stated.

export type { AdwBinProps, AdwClampProps, AdwWidgetProps } from './props.js';

export { AdwBin } from './widgets/bin.js';
export { AdwClamp } from './widgets/clamp.js';
