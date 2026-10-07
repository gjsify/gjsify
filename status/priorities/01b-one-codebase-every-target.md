---
order: 2
tier: high
---
**One codebase on every target, Learn6502 as pilot.** An application should be ONE package: the
   same `.blp` templates, the same component classes (`GObject.registerClass`, `gi://Adw`,
   `gi://Gtk`, `gi://Gio`) and the same app code on gjs, in the browser and on NativeScript.
   Where a platform differs, the difference lives in a suffix file or in a gjsify package, never in a
   second copy of the app. Learn6502 is the pilot: it is the first real app that surfaces each
   missing capability, and each one is fixed in gjsify with a test, not worked around in the app.
   The interface choice runs in this order: a web standard first, then a `gi://` API ported into
   `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript`, then a capability package such as
   `@gjsify/system-accounts` (ADR 0095). How far a project is from that goal is printed by
   `node scripts/report-target-gap.mjs <project-dir>` and written down nowhere; the next steps are
   the entries in `status/open-todos/` that name the report.
