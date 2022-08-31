export const env = {
    get: (name: string) => {
        return process.env[name];
    },
    set: (name: string, value: string) => {
        return process.env[name] = value;
    },
    delete: (name: string) => {
        delete process.env[name];
    },
    toObject: () => {
        return process.env;
    }
}