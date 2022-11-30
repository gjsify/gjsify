import GLib from '@gjsify/types/GLib-2.0';




export const env = {
    get: (key: string) => {
        return GLib.getenv(key);
    },
    set: (key: string, value: string) => {
        return GLib.setenv(key, value, true);
    },
    delete: (key: string) => {
        return GLib.unsetenv(key);
    },
    toObject: () => {
        return GLib.listenv().reduce((env, key) => {
            env[key] = GLib.getenv(key);
            return env;
        }, {});
    }
}