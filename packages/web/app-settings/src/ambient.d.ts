// The two host modules the platform entries import, typed as narrowly as they are used. The
// real declarations (`@girs/gio-2.0`, `@nativescript/core`) are not dependencies of this package.

declare module 'gi://Gio?version=2.0' {
    class Settings {
        constructor(props: { schema_id: string; path?: string });
        readonly schema_id: string;
        readonly path: string;
    }
    const Gio: { Settings: typeof Settings };
    export default Gio;
}

declare module '@nativescript/core' {
    export const ApplicationSettings: {
        hasKey(key: string): boolean;
        getBoolean(key: string): boolean;
        getString(key: string): string;
        getNumber(key: string): number;
        setBoolean(key: string, value: boolean): void;
        setString(key: string, value: string): void;
        setNumber(key: string, value: number): void;
    };
}
