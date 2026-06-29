# `storybook-on-node` E2E

Locks in `gjsify storybook --runtime node` — the storybook-on-Node milestone
(Axis-5 reverse bridge: one GJS/Adwaita storybook source rendering on Node.js
via [`@gjsify/node-gi`](../../../packages/node-gi/node-gi)).

## What `run.mjs` asserts (CI, no display / no addon needed)

A self-contained temp project (`@gjsify/cli` + `@gjsify/storybook` + `@girs/*`
from packed tarballs + one minimal `*.story.ts`) builds the storybook for both
targets via `--build-only` and checks the **flag + routing**:

- `--runtime node` → an `--app node` bundle: `gi://` rewritten to `requireGi`,
  `@gjsify/node-gi` kept **external** (a native addon), no raw `gi://` left, and
  the output is syntactically valid Node ESM.
- `--runtime gjs` (default, unchanged) → `gi://` stays external, **no** node-gi
  routing.

`@gjsify/node-gi` is external for `--app node`, and `--build-only` returns
before the launch step, so this needs **no C++ toolchain and no display** — it
runs on a plain Node CI host.

## Real render assertion (display + addon)

The window-appears / `windows>=1` / clean-exit proof needs a real display and
the node-gyp-built `@gjsify/node-gi` addon, so it is verified **locally** (real
Wayland) against the actual showcase and documented here. Recipe:

```bash
# 1. Build the node-gi addon (once):
( cd packages/node-gi/node-gi && npm install --foreground-scripts )

# 2. Symlink it into the showcase (local artifact, gitignored):
ln -sfn "$PWD/packages/node-gi/node-gi" \
        showcases/gtk/adwaita-storybook/node_modules/@gjsify/node-gi

# 3. Render the real 35-story showcase on Node (interactive — Ctrl+C to quit):
cd showcases/gtk/adwaita-storybook
gjsify storybook --runtime node
```

For an automated `windows>=1` + exit-0 assertion, generate a render-probe from
the discovered entry (`gjsify storybook --runtime node --build-only` writes
`node_modules/.cache/gjsify-storybook/entry.ts`): copy it, add a
`GLib.timeout_add(...)` that reads `Gio.Application.get_default().get_windows()`,
prints the count and `quit()`s, build it `--app node`, and run it under the
display — it prints `windows=1` and exits 0. (Proven: 35-story showcase renders
on Node under Wayland — see the `project_adwaita_storybook_on_node` memory.)
