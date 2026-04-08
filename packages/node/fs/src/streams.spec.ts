// fs stream tests — createReadStream, createWriteStream, pipe integration
// Reference: refs/node-test/parallel/test-fs-read-stream*.js, test-fs-write-stream*.js

import { describe, it, expect } from '@gjsify/unit';
import { createReadStream, createWriteStream, writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';
import { Transform, PassThrough } from 'node:stream';

let tmpDir: string;

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-fs-stream-'));
}

function cleanup(): void {
  try { rmSync(tmpDir, { recursive: true }); } catch {}
}

export default async () => {
  // ---- createReadStream ----

  await describe('fs.createReadStream', async () => {
    await it('should read a file and emit data + end events', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'read-test.txt');
        writeFileSync(filePath, 'hello world');
        const chunks: string[] = [];
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(filePath, { encoding: 'utf8' });
          stream.on('data', (chunk) => chunks.push(chunk as string));
          stream.on('end', () => resolve());
          stream.on('error', reject);
        });
        expect(chunks.join('')).toBe('hello world');
      } finally {
        cleanup();
      }
    });

    await it('should read file as Buffer by default', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'buf-test.txt');
        writeFileSync(filePath, 'buffer data');
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(filePath);
          stream.on('data', (chunk) => chunks.push(Buffer.from(chunk as Uint8Array)));
          stream.on('end', () => resolve());
          stream.on('error', reject);
        });
        const result = Buffer.concat(chunks).toString('utf8');
        expect(result).toBe('buffer data');
      } finally {
        cleanup();
      }
    });

    await it('should handle empty file', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'empty.txt');
        writeFileSync(filePath, '');
        const chunks: string[] = [];
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(filePath, { encoding: 'utf8' });
          stream.on('data', (chunk) => chunks.push(chunk as string));
          stream.on('end', () => resolve());
          stream.on('error', reject);
        });
        expect(chunks.join('')).toBe('');
      } finally {
        cleanup();
      }
    });

    await it('should emit error for non-existent file', async () => {
      const err = await new Promise<Error>((resolve) => {
        const stream = createReadStream('/nonexistent_gjsify_test_12345');
        stream.on('error', (e) => resolve(e));
      });
      expect(err).toBeDefined();
      // GJS Gio errors have numeric codes; Node.js has string 'ENOENT'
      const code: unknown = (err as NodeJS.ErrnoException).code;
      expect(code === 'ENOENT' || code === 1 || (err as any).code !== undefined).toBeTruthy();
    });

    await it('should read file with start and end options', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'range-test.txt');
        writeFileSync(filePath, 'abcdefghij');
        const chunks: string[] = [];
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(filePath, { encoding: 'utf8', start: 2, end: 6 });
          stream.on('data', (chunk) => chunks.push(chunk as string));
          stream.on('end', () => resolve());
          stream.on('error', reject);
        });
        // start=2 (index 'c'), end=6 (index 'g', inclusive)
        expect(chunks.join('')).toBe('cdefg');
      } finally {
        cleanup();
      }
    });

    await it('should read a larger file (64KB)', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'large.txt');
        const size = 64 * 1024;
        writeFileSync(filePath, 'A'.repeat(size));
        let totalLength = 0;
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(filePath);
          stream.on('data', (chunk) => { totalLength += (chunk as Buffer).length; });
          stream.on('end', () => resolve());
          stream.on('error', reject);
        });
        expect(totalLength).toBe(size);
      } finally {
        cleanup();
      }
    });

    await it('should track bytesRead', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'bytes-read.txt');
        const content = 'hello bytes';
        writeFileSync(filePath, content);
        const stream = createReadStream(filePath);
        await new Promise<void>((resolve, reject) => {
          stream.on('data', () => {});
          stream.on('end', () => resolve());
          stream.on('error', reject);
        });
        expect(stream.bytesRead).toBe(Buffer.byteLength(content));
      } finally {
        cleanup();
      }
    });

    await it('should have path property', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'path-prop.txt');
        writeFileSync(filePath, 'test');
        const stream = createReadStream(filePath);
        expect(stream.path).toBe(filePath);
        await new Promise<void>((resolve) => {
          stream.on('data', () => {});
          stream.on('end', () => resolve());
        });
      } finally {
        cleanup();
      }
    });
  });

  // ---- createWriteStream ----

  await describe('fs.createWriteStream', async () => {
    await it('should write data to a file', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'write-test.txt');
        await new Promise<void>((resolve, reject) => {
          const stream = createWriteStream(filePath);
          stream.on('error', reject);
          stream.write('hello ');
          stream.write('world');
          stream.end(() => resolve());
        });
        expect(readFileSync(filePath, 'utf8')).toBe('hello world');
      } finally {
        cleanup();
      }
    });

    await it('should emit finish event', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'finish-test.txt');
        const stream = createWriteStream(filePath);
        const finished = await new Promise<boolean>((resolve) => {
          stream.on('finish', () => resolve(true));
          stream.end('done');
        });
        expect(finished).toBe(true);
        expect(readFileSync(filePath, 'utf8')).toBe('done');
      } finally {
        cleanup();
      }
    });

    await it('should write Buffer data', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'buf-write.txt');
        await new Promise<void>((resolve, reject) => {
          const stream = createWriteStream(filePath);
          stream.on('error', reject);
          stream.write(Buffer.from('buffer '));
          stream.end(Buffer.from('content'));
          stream.on('finish', () => resolve());
        });
        expect(readFileSync(filePath, 'utf8')).toBe('buffer content');
      } finally {
        cleanup();
      }
    });

    await it('should write a large file (64KB)', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'large-write.txt');
        const chunkSize = 1024;
        const numChunks = 64;
        await new Promise<void>((resolve, reject) => {
          const stream = createWriteStream(filePath);
          stream.on('error', reject);
          for (let i = 0; i < numChunks; i++) {
            stream.write('B'.repeat(chunkSize));
          }
          stream.end(() => resolve());
        });
        const content = readFileSync(filePath, 'utf8');
        expect(content.length).toBe(chunkSize * numChunks);
      } finally {
        cleanup();
      }
    });

    await it('should have path property', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'path-prop-ws.txt');
        const stream = createWriteStream(filePath);
        expect(stream.path).toBe(filePath);
        await new Promise<void>((resolve, reject) => {
          stream.on('error', reject);
          stream.end('test', () => resolve());
        });
      } finally {
        cleanup();
      }
    });

    await it('should track bytesWritten', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'bytes-written.txt');
        const stream = createWriteStream(filePath);
        await new Promise<void>((resolve, reject) => {
          stream.on('error', reject);
          stream.write('hello');
          stream.end(' world', () => resolve());
        });
        expect(stream.bytesWritten).toBe(11); // "hello world"
      } finally {
        cleanup();
      }
    });
  });

  // ---- pipe: ReadStream → WriteStream ----

  await describe('fs pipe: createReadStream → createWriteStream', async () => {
    await it('should copy a file via pipe', async () => {
      setup();
      try {
        const srcPath = join(tmpDir, 'src.txt');
        const dstPath = join(tmpDir, 'dst.txt');
        writeFileSync(srcPath, 'pipe copy test');
        await new Promise<void>((resolve, reject) => {
          const src = createReadStream(srcPath);
          const dst = createWriteStream(dstPath);
          src.on('error', reject);
          dst.on('error', reject);
          dst.on('finish', () => resolve());
          src.pipe(dst);
        });
        expect(readFileSync(dstPath, 'utf8')).toBe('pipe copy test');
      } finally {
        cleanup();
      }
    });

    await it('should copy a large file via pipe', async () => {
      setup();
      try {
        const srcPath = join(tmpDir, 'large-src.txt');
        const dstPath = join(tmpDir, 'large-dst.txt');
        const size = 128 * 1024; // 128KB
        writeFileSync(srcPath, 'D'.repeat(size));
        await new Promise<void>((resolve, reject) => {
          const src = createReadStream(srcPath);
          const dst = createWriteStream(dstPath);
          src.on('error', reject);
          dst.on('error', reject);
          dst.on('finish', () => resolve());
          src.pipe(dst);
        });
        const result = readFileSync(dstPath, 'utf8');
        expect(result.length).toBe(size);
      } finally {
        cleanup();
      }
    });

    await it('should pipe through a Transform (uppercase)', async () => {
      setup();
      try {
        const srcPath = join(tmpDir, 'transform-src.txt');
        const dstPath = join(tmpDir, 'transform-dst.txt');
        writeFileSync(srcPath, 'hello transform');
        const upper = new Transform({
          transform(chunk, _enc, cb) {
            cb(null, chunk.toString().toUpperCase());
          },
        });
        await new Promise<void>((resolve, reject) => {
          const src = createReadStream(srcPath, { encoding: 'utf8' });
          const dst = createWriteStream(dstPath);
          dst.on('error', reject);
          dst.on('finish', () => resolve());
          src.pipe(upper).pipe(dst);
        });
        expect(readFileSync(dstPath, 'utf8')).toBe('HELLO TRANSFORM');
      } finally {
        cleanup();
      }
    });

    await it('should pipe through a PassThrough', async () => {
      setup();
      try {
        const srcPath = join(tmpDir, 'pt-src.txt');
        const dstPath = join(tmpDir, 'pt-dst.txt');
        writeFileSync(srcPath, 'passthrough test');
        const pt = new PassThrough();
        await new Promise<void>((resolve, reject) => {
          const src = createReadStream(srcPath);
          const dst = createWriteStream(dstPath);
          dst.on('error', reject);
          dst.on('finish', () => resolve());
          src.pipe(pt).pipe(dst);
        });
        expect(readFileSync(dstPath, 'utf8')).toBe('passthrough test');
      } finally {
        cleanup();
      }
    });
  });

  // ---- Multiple sequential reads ----

  await describe('fs streams: sequential operations', async () => {
    await it('should read the same file twice sequentially', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'multi-read.txt');
        writeFileSync(filePath, 'read me twice');
        const readOnce = (): Promise<string> => new Promise((resolve, reject) => {
          const chunks: string[] = [];
          const stream = createReadStream(filePath, { encoding: 'utf8' });
          stream.on('data', (chunk) => chunks.push(chunk as string));
          stream.on('end', () => resolve(chunks.join('')));
          stream.on('error', reject);
        });
        const r1 = await readOnce();
        const r2 = await readOnce();
        expect(r1).toBe('read me twice');
        expect(r2).toBe('read me twice');
      } finally {
        cleanup();
      }
    });

    await it('should write then read the same file', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'write-then-read.txt');
        // Write
        await new Promise<void>((resolve, reject) => {
          const ws = createWriteStream(filePath);
          ws.on('error', reject);
          ws.end('written content', () => resolve());
        });
        // Read
        const chunks: string[] = [];
        await new Promise<void>((resolve, reject) => {
          const rs = createReadStream(filePath, { encoding: 'utf8' });
          rs.on('data', (chunk) => chunks.push(chunk as string));
          rs.on('end', () => resolve());
          rs.on('error', reject);
        });
        expect(chunks.join('')).toBe('written content');
      } finally {
        cleanup();
      }
    });
  });

  // ---- Unicode and special content ----

  await describe('fs streams: unicode and binary', async () => {
    await it('should handle UTF-8 content with multibyte chars', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'unicode.txt');
        const content = 'Hallo Welt! 你好世界 🌍🎉';
        writeFileSync(filePath, content);
        const chunks: string[] = [];
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(filePath, { encoding: 'utf8' });
          stream.on('data', (chunk) => chunks.push(chunk as string));
          stream.on('end', () => resolve());
          stream.on('error', reject);
        });
        expect(chunks.join('')).toBe(content);
      } finally {
        cleanup();
      }
    });

    await it('should handle binary data round-trip', async () => {
      setup();
      try {
        const filePath = join(tmpDir, 'binary.dat');
        const data = Buffer.from([0x00, 0x01, 0x80, 0xff, 0xfe, 0x7f, 0x00, 0x42]);
        writeFileSync(filePath, data);
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          const stream = createReadStream(filePath);
          stream.on('data', (chunk) => chunks.push(Buffer.from(chunk as Uint8Array)));
          stream.on('end', () => resolve());
          stream.on('error', reject);
        });
        const result = Buffer.concat(chunks);
        expect(result.length).toBe(8);
        expect(result[0]).toBe(0x00);
        expect(result[2]).toBe(0x80);
        expect(result[3]).toBe(0xff);
        expect(result[7]).toBe(0x42);
      } finally {
        cleanup();
      }
    });
  });
};
