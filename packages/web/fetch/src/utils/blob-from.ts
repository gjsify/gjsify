// Use global Blob/File if available, otherwise provide minimal shims
const Blob = globalThis.Blob ?? class Blob {
  private _parts: any[];
  private _options: BlobPropertyBag;
  readonly size: number;
  readonly type: string;
  constructor(parts?: any[], options?: BlobPropertyBag) {
    this._parts = parts || [];
    this._options = options || {};
    this.type = options?.type || '';
    this.size = this._parts.reduce((acc: number, part: any) => {
      if (typeof part === 'string') return acc + new TextEncoder().encode(part).byteLength;
      if (part instanceof ArrayBuffer) return acc + part.byteLength;
      if (ArrayBuffer.isView(part)) return acc + part.byteLength;
      if (part && typeof part.size === 'number') return acc + part.size;
      return acc;
    }, 0);
  }
  async text(): Promise<string> { return new TextDecoder().decode(await this.arrayBuffer()); }
  async arrayBuffer(): Promise<ArrayBuffer> {
    const chunks: Uint8Array[] = [];
    for (const part of this._parts) {
      if (typeof part === 'string') chunks.push(new TextEncoder().encode(part));
      else if (part instanceof ArrayBuffer) chunks.push(new Uint8Array(part));
      else if (ArrayBuffer.isView(part)) chunks.push(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
      else if (part && typeof part.stream === 'function') {
        for await (const chunk of part.stream()) {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
        }
      }
    }
    const total = chunks.reduce((a, c) => a + c.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.byteLength; }
    return result.buffer;
  }
  slice(start?: number, end?: number, type?: string): Blob { return new Blob([], { type }); }
};

const File = globalThis.File ?? class File extends Blob {
  readonly name: string;
  readonly lastModified: number;
  constructor(parts: any[], name: string, options?: FilePropertyBag) {
    super(parts, options);
    this.name = name;
    this.lastModified = options?.lastModified ?? Date.now();
  }
};

class DOMException extends Error {
  constructor(message?: string, name?: string) {
    super(message);
    this.name = name || 'Error';
  }
}

import {
    realpathSync,
    statSync,
    rmdirSync,
    createReadStream,
    promises as fs
} from 'node:fs'
import { basename, sep, join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'

// import Blob from './index.js'

const { stat, mkdtemp } = fs
let i = 0, tempDir, registry

/**
 * @param {string} path filepath on the disk
 * @param {string} [type] mimetype to use
 */
const blobFromSync = (path: string, type: string) => fromBlob(statSync(path), path, type)

/**
 * @param {string} path filepath on the disk
 * @param {string} [type] mimetype to use
 * @returns {Promise<Blob>}
 */
const blobFrom = (path: string, type: string): Promise<Blob> => stat(path).then(stat => fromBlob(stat, path, type))

/**
 * @param {string} path filepath on the disk
 * @param {string} [type] mimetype to use
 * @returns {Promise<File>}
 */
const fileFrom = (path: string, type: string): Promise<File> => stat(path).then(stat => fromFile(stat, path, type))

/**
 * @param {string} path filepath on the disk
 * @param {string} [type] mimetype to use
 */
const fileFromSync = (path: string, type: string) => fromFile(statSync(path), path, type)

// @ts-ignore
const fromBlob = (stat, path, type = '') => new Blob([new BlobDataItem({
    path,
    size: stat.size,
    lastModified: stat.mtimeMs,
    start: 0
})], { type })

// @ts-ignore
const fromFile = (stat, path, type = '') => new File([new BlobDataItem({
    path,
    size: stat.size,
    lastModified: stat.mtimeMs,
    start: 0
})], basename(path), { type, lastModified: stat.mtimeMs })

/**
 * Creates a temporary blob backed by the filesystem.
 * NOTE: requires node.js v14 or higher to use FinalizationRegistry
 *
 * @param {*} data Same as fs.writeFile data
 * @param {BlobPropertyBag & {signal?: AbortSignal}} options
 * @param {AbortSignal} [signal] in case you wish to cancel the write operation
 * @returns {Promise<Blob>}
 */
const createTemporaryBlob = async (data: any, { signal, type }: BlobPropertyBag & { signal?: AbortSignal; } = {}): Promise<Blob> => {
    registry = registry || new FinalizationRegistry(fs.unlink)
    tempDir = tempDir || await mkdtemp(realpathSync(tmpdir()) + sep)
    const id = `${i++}`
    const destination = join(tempDir, id)
    if (data instanceof ArrayBuffer) data = new Uint8Array(data)
    await fs.writeFile(destination, data, { signal })
    const blob = await blobFrom(destination, type)
    registry.register(blob, destination)
    return blob
}

/**
 * Creates a temporary File backed by the filesystem.
 * Pretty much the same as constructing a new File(data, name, options)
 *
 * NOTE: requires node.js v14 or higher to use FinalizationRegistry
 * @param {*} data
 * @param {string} name
 * @param {FilePropertyBag & {signal?: AbortSignal}} opts
 * @returns {Promise<File>}
 */
const createTemporaryFile = async (data: any, name: string, opts: FilePropertyBag & { signal?: AbortSignal; }): Promise<File> => {
    const blob = await createTemporaryBlob(data)
    return new File([blob], name, opts)
}

/**
 * This is a blob backed up by a file on the disk
 * with minium requirement. Its wrapped around a Blob as a blobPart
 * so you have no direct access to this.
 *
 * @private
 */
class BlobDataItem {
    #path: string;
    #start: number;
    size
    lastModified
    originalSize

    constructor(options) {
        this.#path = options.path
        this.#start = options.start
        this.size = options.size
        this.lastModified = options.lastModified
        this.originalSize = options.originalSize === undefined
            ? options.size
            : options.originalSize
    }

    /**
     * Slicing arguments is first validated and formatted
     * to not be out of range by Blob.prototype.slice
     */
    slice(start: number, end: number) {
        return new BlobDataItem({
            path: this.#path,
            lastModified: this.lastModified,
            originalSize: this.originalSize,
            size: end - start,
            start: this.#start + start
        })
    }

    async * stream() {
        const { mtimeMs, size } = await stat(this.#path)

        if (mtimeMs > this.lastModified || this.originalSize !== size) {
            throw new DOMException('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.', 'NotReadableError')
        }

        yield* createReadStream(this.#path, {
            start: this.#start,
            end: this.#start + this.size - 1
        })
    }

    get [Symbol.toStringTag]() {
        return 'Blob'
    }
}

process.once('exit', () => {
    tempDir && rmdirSync(tempDir, { recursive: true })
})

export default blobFromSync
export {
    Blob,
    blobFrom,
    blobFromSync,
    createTemporaryBlob,
    File,
    fileFrom,
    fileFromSync,
    createTemporaryFile
}