/**
 * FormData implementation for GJS.
 * Spec: https://xhr.spec.whatwg.org/#interface-formdata
 */

import { File } from './file.ts';

type FormDataEntryValue = string | File;
interface FormDataEntry {
    name: string;
    value: FormDataEntryValue;
}

const _entries = Symbol('FormData.entries');

function normalizeValue(name: string, value: FormDataEntryValue | Blob, filename?: string): FormDataEntryValue {
    if (typeof value === 'string') {
        return value;
    }

    // If value is a Blob but not a File, wrap it in a File
    if (value instanceof Blob && !(value instanceof File)) {
        value = new File([value], filename ?? 'blob', { type: value.type });
    }

    // If value is a File and filename is given, create new File with that name
    if (value instanceof File && filename !== undefined) {
        value = new File([value], filename, {
            type: value.type,
            lastModified: value.lastModified,
        });
    }

    return value as FormDataEntryValue;
}

export class FormData {
    [_entries]: FormDataEntry[] = [];

    constructor() {
        // No-arg constructor per spec
    }

    append(name: string, value: string): void;
    append(name: string, blobValue: Blob, filename?: string): void;
    append(name: string, value: string | Blob, filename?: string): void {
        this[_entries].push({
            name: String(name),
            value: normalizeValue(name, value as FormDataEntryValue | Blob, filename),
        });
    }

    delete(name: string): void {
        const n = String(name);
        this[_entries] = this[_entries].filter(e => e.name !== n);
    }

    get(name: string): FormDataEntryValue | null {
        const n = String(name);
        const entry = this[_entries].find(e => e.name === n);
        return entry ? entry.value : null;
    }

    getAll(name: string): FormDataEntryValue[] {
        const n = String(name);
        return this[_entries].filter(e => e.name === n).map(e => e.value);
    }

    has(name: string): boolean {
        const n = String(name);
        return this[_entries].some(e => e.name === n);
    }

    set(name: string, value: string): void;
    set(name: string, blobValue: Blob, filename?: string): void;
    set(name: string, value: string | Blob, filename?: string): void {
        const n = String(name);
        const normalized = normalizeValue(n, value as FormDataEntryValue | Blob, filename);
        let found = false;
        this[_entries] = this[_entries].filter(e => {
            if (e.name === n) {
                if (!found) {
                    found = true;
                    e.value = normalized;
                    return true;
                }
                return false; // remove duplicates
            }
            return true;
        });
        if (!found) {
            this[_entries].push({ name: n, value: normalized });
        }
    }

    forEach(callback: (value: FormDataEntryValue, key: string, parent: FormData) => void, thisArg?: any): void {
        for (const entry of this[_entries]) {
            callback.call(thisArg, entry.value, entry.name, this);
        }
    }

    *entries(): IterableIterator<[string, FormDataEntryValue]> {
        for (const entry of this[_entries]) {
            yield [entry.name, entry.value];
        }
    }

    *keys(): IterableIterator<string> {
        for (const entry of this[_entries]) {
            yield entry.name;
        }
    }

    *values(): IterableIterator<FormDataEntryValue> {
        for (const entry of this[_entries]) {
            yield entry.value;
        }
    }

    [Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]> {
        return this.entries();
    }

    get [Symbol.toStringTag](): string {
        return 'FormData';
    }
}
