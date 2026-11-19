// The NativeScript-Android driver: androidx.sqlite through @gjsify/native-sqlite-bridge
// (ADR 0147). Picked over native.ts by the `.android` platform suffix of `--app nativescript`.

import { loadNativescriptSqlite } from '@gjsify/native-sqlite-bridge';
import type { SqliteDriverModule } from '@gjsify/sqlite-native/driver';

let driver: SqliteDriverModule | undefined;

export function nativeSqlite(): SqliteDriverModule {
    return (driver ??= loadNativescriptSqlite());
}
