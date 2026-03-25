// WHATWG Blob/File polyfill for GJS
// Reference: Node.js lib/buffer.js (Blob), refs/deno/ext/web/09_file.js
// Node.js exports Blob from 'buffer' since v18.
// On GJS, globalThis.Blob is not available — this provides a minimal polyfill.

const _encoder = new TextEncoder();

class BlobPolyfill implements Blob {
  _parts: BlobPart[];
  readonly size: number;
  readonly type: string;

  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    this._parts = parts || [];
    this.type = options?.type || '';
    this.size = this._parts.reduce((acc: number, part: BlobPart) => {
      if (typeof part === 'string') return acc + _encoder.encode(part).byteLength;
      if (part instanceof ArrayBuffer) return acc + part.byteLength;
      if (ArrayBuffer.isView(part)) return acc + part.byteLength;
      if (part && typeof (part as Blob).size === 'number') return acc + (part as Blob).size;
      return acc;
    }, 0);
  }

  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    const ab = await this.arrayBuffer();
    return new Uint8Array(ab);
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const chunks: Uint8Array[] = [];
    for (const part of this._parts) {
      if (typeof part === 'string') chunks.push(_encoder.encode(part));
      else if (part instanceof ArrayBuffer) chunks.push(new Uint8Array(part));
      else if (ArrayBuffer.isView(part)) chunks.push(new Uint8Array(part.buffer as ArrayBuffer, part.byteOffset, part.byteLength));
      else if (part && typeof (part as Blob).arrayBuffer === 'function') {
        const ab = await (part as Blob).arrayBuffer();
        chunks.push(new Uint8Array(ab));
      }
    }
    const total = chunks.reduce((a, c) => a + c.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.byteLength; }
    return result.buffer as ArrayBuffer;
  }

  slice(start?: number, end?: number, type?: string): Blob {
    return new BlobPolyfill([], { type }) as unknown as Blob;
  }

  stream(): ReadableStream {
    throw new Error('Blob.stream() not implemented');
  }
}

class FilePolyfill extends BlobPolyfill {
  readonly name: string;
  readonly lastModified: number;
  readonly webkitRelativePath: string = '';

  constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
    super(parts, options);
    this.name = name;
    this.lastModified = options?.lastModified ?? Date.now();
  }
}

// Use native if available, polyfill otherwise
const Blob = globalThis.Blob ?? BlobPolyfill;
const File = (globalThis as any).File ?? FilePolyfill;

export { Blob, File };
