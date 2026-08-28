// The BASE barrel — what a tool that ignores `exports` loads through `module`/`main`.
// Everything it names refuses at first render; who reaches it is in `refuse.ts`.
//
// IT RE-EXPORTS THE BASE MODULES, NEVER A PLATFORM SIBLING: a sibling named here would
// RUN on the wrong half as a working worse copy of the widget, which is why
// `scripts/check-adwaita-rn-platform-split.mjs` rule 3 refuses one.
//
// It is also the package's TYPE authority — `exports["."].types` names the declarations
// generated from here, so one declaration describes both platform builds. `parity.spec.ts`
// is what makes both halves satisfy it.

export type { AdwBinProps, AdwClampProps, AdwWidgetProps } from './props.js';

export { AdwBin } from './widgets/bin.js';
export { AdwClamp } from './widgets/clamp.js';
