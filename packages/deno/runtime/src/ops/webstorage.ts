type Memory = { [key: string]: string }

// TODO make this persistent
let persistentMemory: Memory = {};
let ephemeralMemory: Memory = {};

export const op_webstorage_length = (persistent: boolean) => {
    console.warn("Not implemented: ops.op_webstorage_length");
    const mem = persistent ? persistentMemory : ephemeralMemory;
    return Object.keys(mem).length;
}
export const op_webstorage_key = (index: number, persistent: boolean) => {
    console.warn("Not implemented: ops.op_webstorage_key");
    const mem = persistent ? persistentMemory : ephemeralMemory;
    const keys = Object.keys(mem);
    return keys[index] || null;
}
export const op_webstorage_set = (key: string, value: string, persistent: boolean) => {
    console.warn("Not implemented: ops.op_webstorage_set");
    const mem = persistent ? persistentMemory : ephemeralMemory;
    mem[key] = value;
}
export const op_webstorage_get = (key: string, persistent: boolean): string | null => {
    console.warn("Not implemented: ops.op_webstorage_get");
    const mem = persistent ? persistentMemory : ephemeralMemory;
    return mem[key] || null;
}
export const op_webstorage_remove = (key: string, persistent: boolean) => {
    console.warn("Not implemented: ops.op_webstorage_remove");
    const mem = persistent ? persistentMemory : ephemeralMemory;
    delete mem[key];
}
export const op_webstorage_clear = (persistent: boolean) => {
    console.warn("Not implemented: ops.op_webstorage_clear");
    if (persistent) {
        persistentMemory = {};
    } else {
        ephemeralMemory = {}
    }
}
export const op_webstorage_iterate_keys = (persistent: boolean) => {
    console.warn("Not implemented: ops.op_webstorage_iterate_keys");
    const mem = persistent ? persistentMemory : ephemeralMemory;
    return Object.keys(mem);
}