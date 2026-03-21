/**
 * Blob/File shims for environments that don't provide them natively.
 *
 * Uses globalThis.Blob/File when available (Node.js 18+, modern browsers),
 * otherwise provides minimal implementations.
 */

const _encoder = new TextEncoder();

const Blob = globalThis.Blob ?? class Blob {
  _parts: BlobPart[];
  readonly size: number;
  readonly type: string;
  constructor(parts?: any[], options?: BlobPropertyBag) {
    this._parts = parts || [];
    this.type = options?.type || '';
    this.size = this._parts.reduce((acc: number, part: any) => {
      if (typeof part === 'string') return acc + _encoder.encode(part).byteLength;
      if (part instanceof ArrayBuffer) return acc + part.byteLength;
      if (ArrayBuffer.isView(part)) return acc + part.byteLength;
      if (part && typeof part.size === 'number') return acc + part.size;
      return acc;
    }, 0);
  }
  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    const ab = await this.arrayBuffer();
    return new Uint8Array(ab);
  }
  async text(): Promise<string> { return new TextDecoder().decode(await this.arrayBuffer()); }
  async arrayBuffer(): Promise<ArrayBuffer> {
    const chunks: Uint8Array[] = [];
    for (const part of this._parts) {
      if (typeof part === 'string') chunks.push(_encoder.encode(part));
      else if (part instanceof ArrayBuffer) chunks.push(new Uint8Array(part));
      else if (ArrayBuffer.isView(part)) chunks.push(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
      else if (part && typeof part.arrayBuffer === 'function') {
        const ab = await part.arrayBuffer();
        chunks.push(new Uint8Array(ab));
      }
    }
    const total = chunks.reduce((a, c) => a + c.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.byteLength; }
    return result.buffer;
  }
  slice(start?: number, end?: number, type?: string): Blob { return new Blob([], { type }); }
  stream(): ReadableStream { throw new Error('Not implemented'); }
};

const File = globalThis.File ?? class File extends Blob {
  readonly name: string;
  readonly lastModified: number;
  readonly webkitRelativePath: string = '';
  constructor(parts: any[], name: string, options?: FilePropertyBag) {
    super(parts, options);
    this.name = name;
    this.lastModified = options?.lastModified ?? Date.now();
  }
};

export {
    Blob,
    File,
}
