// The NativeScript-iOS driver: a stub that throws a clear error at the first open (ADR 0147).
// Picked over native.ts by the `.ios` platform suffix of `--app nativescript`.

import { loadNativescriptSqlite } from '@gjsify/native-sqlite-bridge';
import type { SqliteDriverModule } from '@gjsify/sqlite-native/driver';

let driver: SqliteDriverModule | undefined;

export function nativeSqlite(): SqliteDriverModule {
    return (driver ??= loadNativescriptSqlite());
}
