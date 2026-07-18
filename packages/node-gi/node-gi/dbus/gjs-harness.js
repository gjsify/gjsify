// SPDX-License-Identifier: MIT
// Gold-standard harness: runs the shared DBus scenarios under gjs (`gjs -m`) and
// prints `RESULT=<json>` (client half) + `EXPORT_RESULT=<json>` (object-export
// half). dbus.test.mjs spawns this under a private session bus and asserts each
// normalized result equals the node-gi run's — the byte-for-byte gjs
// cross-check. Kept a plain `.js` run via `gjs -m` (ESM).
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import { runScenario } from './scenario.mjs';
import { runExportScenario } from './export-scenario.mjs';

const result = runScenario({ Gio, GLib });
print(`RESULT=${JSON.stringify(result)}`);

const exportResult = runExportScenario({ Gio, GLib });
print(`EXPORT_RESULT=${JSON.stringify(exportResult)}`);
