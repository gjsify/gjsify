// Type-check-only ambient declarations. Nothing here is imported at runtime.
//
// `tsconfig.json` sets `"types": []`, so an ambient package's declarations reach this project
// only by an explicit reference. The `*.blp` / `*.blp?shared-tree` module patterns come from
// the build plugin that serves them, which is the same route every `.blp`-importing showcase
// already takes (`showcases/gtk/adw-blueprint-layout/src/globals.d.ts`).
/// <reference types="@gjsify/vite-plugin-blueprint/types" />
