# adwaita-gallery-vue

Every block of the [Adwaita documentation gallery](../../../website/src/content/docs/adwaita) that
can be written as a static widget tree, **rendered through Vue** — a single-file component compiled by `@vue/compiler-sfc`, compiled by
[`@gjsify/rolldown-plugin-vue`](../../../packages/infra/rolldown-plugin-vue) — and asserted against the real GTK widget tree.

```bash
gjsify run build:gjs && gjsify run start:gjs   # the window
gjsify run probe                               # the assertions
```

## This file is GENERATED, and that is the point

`src/` comes from `scripts/generate-adwaita-framework-snippets.mjs`, out of the one tree per
widget in `scripts/adwaita-gallery-trees.mjs` — the same run that writes
`website/src/data/adwaita-framework-snippets.ts`. So the markup asserted here is the SAME TEXT
the website ships: a snippet nobody ran is a claim, and this showcase is what turns it into a
measurement. `scripts/check-generated-website-data.mjs` fails if either output drifts from the
source.

40 gallery blocks times three adapters is 120 snippets, and the three adapters render the same
element tree — `@gjsify/gtk-host` is one host with three subpaths, and
`check-adapter-import-direction.mjs` already forbids an adapter from containing a widget name at
all. What differs between them is syntax, which is the one thing a generator is reliably better at
than a person.

## What is measured

18 widget trees, in one mount, with the diagnostics gate on:
`PROBE: PASS {"diagnostics":0,"widgets":18,"unverifiedSlots":2}`. The three showcases produce
**byte-identical tree signatures** for all 18 — that identity is the claim the shared source
rests on, and it is checked rather than assumed.

Slots are asserted as **placement** wherever the widget has a readable counterpart —
`Adw.ToolbarView.get_content()`, `Adw.HeaderBar.get_title_widget()`, the `top-bar`/`bottom-bar`
style class libadwaita puts on each toolbar's revealer, the `Gtk.CenterBox` inside every header
bar. `Adw.ActionRow`'s `prefix`/`suffix` have none, so they are counted as **unverified**
rather than passed: "the child is somewhere in the subtree" is true of every slot it could have
gone into. Falsified by dropping `slot` from the emitter — all three showcases then fail on the
same seven checks.

## License

MIT
