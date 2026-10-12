// GJS entry: the native `Gio.Settings`, re-exported — ADR 0099 § 6. `register` is the one
// addition to GIO's names; on GJS the compiled schema is what GSettings reads, so it is a no-op.

import Gio from 'gi://Gio?version=2.0';

export const Settings = Object.assign(Gio.Settings, { register(_schema: unknown): void {} });
export type Settings = InstanceType<typeof Gio.Settings>;
