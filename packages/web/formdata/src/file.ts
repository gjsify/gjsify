/**
 * File class — extends Blob with name and lastModified.
 * Used by FormData when appending Blob values with a filename.
 */

const _name = Symbol('File.name');
const _lastModified = Symbol('File.lastModified');

export class File extends Blob {
    [_name]: string;
    [_lastModified]: number;

    readonly webkitRelativePath: string = '';

    constructor(fileBits: BlobPart[], fileName: string, options?: FilePropertyBag) {
        super(fileBits, options);
        this[_name] = String(fileName);
        this[_lastModified] = options?.lastModified ?? Date.now();
    }

    get name(): string {
        return this[_name];
    }

    get lastModified(): number {
        return this[_lastModified];
    }

    get [Symbol.toStringTag](): string {
        return 'File';
    }
}
