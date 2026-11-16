// NativeScript native bridge for node:sqlite — ADR 0147.
// The driver contract is `@gjsify/sqlite-native/driver`; `createSqliteDriver` adapts any
// androidx.sqlite shaped backend to it, `loadNativescriptSqlite` picks the platform one.

import { assertNativeScript, isAndroid } from '@gjsify/native-platform';
import type { SqliteDriverModule } from '@gjsify/sqlite-native/driver';

import { createAndroidBackend } from './android.js';
import { createSqliteDriver } from './driver.js';
import { createIosBackend } from './ios.js';

export { createSqliteDriver, toDriverError } from './driver.js';
export type { RawBackend, RawConnection, RawStatement } from './driver.js';
export { scanParameters, splitStatements } from './sql-scan.js';

/** The driver for the platform this NativeScript app runs on. */
export function loadNativescriptSqlite(): SqliteDriverModule {
    assertNativeScript();
    return createSqliteDriver(isAndroid ? createAndroidBackend() : createIosBackend());
}
