// NativeScript native bridge for node:sqlite — ADR 0146.
// The driver contract is `@gjsify/sqlite-native/driver`; `createSqliteDriver` adapts any
// androidx.sqlite shaped backend to it, `loadNativescriptSqlite` picks the platform one.

export { createSqliteDriver, toDriverError } from './driver.js';
export type { RawBackend, RawConnection, RawStatement } from './driver.js';
export { scanParameters, splitStatements } from './sql-scan.js';
