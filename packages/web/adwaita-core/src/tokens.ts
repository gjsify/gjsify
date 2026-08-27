// The Adwaita design tokens, as data every surface can read.
//
// `@gjsify/adwaita-web` holds the SOURCE (its `scss/_variables.scss` is where the
// values are written and reviewed) but is browser-only — `gjs:none, node:none,
// nativescript:none` — so it cannot be where a GTK, NativeScript or React Native
// consumer reads them. This package can: all four runtime slots `polyfill`,
// `headless: true`, and no toolkit reach at all.
//
// Generated, never hand-edited: `scripts/generate-adwaita-tokens.mjs`, held by
// `scripts/check-generated-website-data.mjs`.
//
// NOT a `StyleTokens` scale. These are the CSS custom properties of the theming
// contract (`--window-bg-color`, `--spacing-m`), not the Tailwind-shaped families
// `@gjsify/gtk-host/style` consumes. Projecting one onto the other is a mapping
// decision — which property belongs to `spacing`, which to `colors` — and it is a
// separate change, so that the mapping can be reviewed as a mapping rather than
// arriving inside a generator move.

export {
    ADWAITA_DARK_ONLY_TOKENS,
    ADWAITA_TOKEN_COUNT,
    ADWAITA_TOKENS,
    ADWAITA_UNRESOLVED_TOKENS,
    type AdwTokenValues,
} from './tokens.generated.js';
