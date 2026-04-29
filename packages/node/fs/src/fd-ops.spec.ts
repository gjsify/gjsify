// Ported from refs/node-test/parallel/test-fs-read-sync.js + test-fs-write-sync.js (behavior)
// Original: MIT, Node.js contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import {
  openSync, closeSync,
  fstatSync, fstat,
  ftruncateSync,
  fdatasync, fsync,
  fchmodSync,
  readSync, writeSync,
  readv, writev,
  exists,
  openAsBlob,
  promises,
  writeFileSync, unlinkSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = tmpdir();

function tmpFile(name: string, content = 'hello world'): string {
  const p = join(TMP, `gjsify-fdops-${name}-${process.pid}`);
  writeFileSync(p, content);
  return p;
}

export default async () => {
  await describe('fs fd-based operations', async () => {
    await it('fstatSync returns Stats with correct size', async () => {
      const f = tmpFile('fstat', 'hello');
      const fd = openSync(f, 'r');
      try {
        const st = fstatSync(fd);
        expect(st.size).toBe(5);
        expect(typeof st.mtime).toBe('object');
      } finally {
        closeSync(fd);
        unlinkSync(f);
      }
    });

    await it('fstat callback returns Stats', async () => {
      const f = tmpFile('fstat-cb', 'world');
      const fd = openSync(f, 'r');
      try {
        const st = await new Promise<any>((resolve, reject) => {
          fstat(fd, (err, s) => err ? reject(err) : resolve(s));
        });
        expect(st.size).toBe(5);
      } finally {
        closeSync(fd);
        unlinkSync(f);
      }
    });

    await it('promises.fstat returns Stats', async () => {
      const f = tmpFile('fstat-p', 'gjsify');
      const fh = await promises.open(f, 'r');
      try {
        const st = await fh.stat();
        expect(st.size).toBe(6);
      } finally {
        await fh.close();
        unlinkSync(f);
      }
    });

    await it('ftruncateSync truncates file', async () => {
      const f = tmpFile('ftrunc', '0123456789');
      const fd = openSync(f, 'r+');
      try {
        ftruncateSync(fd, 4);
        const data = readFileSync(f, 'utf8');
        expect(data).toBe('0123');
      } finally {
        closeSync(fd);
        unlinkSync(f);
      }
    });

    await it('fdatasync callback completes without error', async () => {
      const f = tmpFile('fdatasync', 'data');
      const fd = openSync(f, 'r+');
      try {
        await new Promise<void>((resolve, reject) => {
          fdatasync(fd, (err) => err ? reject(err) : resolve());
        });
      } finally {
        closeSync(fd);
        unlinkSync(f);
      }
    });

    await it('fsync callback completes without error', async () => {
      const f = tmpFile('fsync', 'data');
      const fd = openSync(f, 'r+');
      try {
        await new Promise<void>((resolve, reject) => {
          fsync(fd, (err) => err ? reject(err) : resolve());
        });
      } finally {
        closeSync(fd);
        unlinkSync(f);
      }
    });

    await it('fchmodSync changes file permissions', async () => {
      const f = tmpFile('fchmod', 'x');
      const fd = openSync(f, 'r');
      try {
        fchmodSync(fd, 0o600);
        const st = fstatSync(fd);
        expect(st.mode & 0o777).toBe(0o600);
      } finally {
        closeSync(fd);
        unlinkSync(f);
      }
    });

    await it('closeSync closes the fd', async () => {
      const f = tmpFile('close', 'c');
      const fd = openSync(f, 'r');
      closeSync(fd);
      expect(() => fstatSync(fd)).toThrow();
      unlinkSync(f);
    });

    await it('readSync reads bytes from position 0', async () => {
      const f = tmpFile('rsync', 'abcdef');
      const fd = openSync(f, 'r');
      try {
        const buf = Buffer.alloc(3);
        const n = readSync(fd, buf, 0, 3, 0);
        expect(n).toBe(3);
        expect(buf.toString()).toBe('abc');
      } finally {
        closeSync(fd);
        unlinkSync(f);
      }
    });

    await it('readSync reads into buffer at offset', async () => {
      const f = tmpFile('rsync-off', 'hello');
      const fd = openSync(f, 'r');
      try {
        const buf = Buffer.alloc(8);
        const n = readSync(fd, buf, 2, 5, 0);
        expect(n).toBe(5);
        expect(buf.slice(2, 7).toString()).toBe('hello');
      } finally {
        closeSync(fd);
        unlinkSync(f);
      }
    });

    await it('writeSync writes bytes to file', async () => {
      const f = tmpFile('wsync', '-----');
      const fd = openSync(f, 'r+');
      try {
        const n = writeSync(fd, Buffer.from('XYZ'), 0, 3, 0);
        expect(n).toBe(3);
        closeSync(fd);
        expect(readFileSync(f, 'utf8').slice(0, 3)).toBe('XYZ');
      } finally {
        unlinkSync(f);
      }
    });

    await it('readv reads into multiple buffers', async () => {
      const f = tmpFile('readv', 'abcdef');
      const fd = openSync(f, 'r');
      try {
        const b1 = Buffer.alloc(2);
        const b2 = Buffer.alloc(3);
        await new Promise<void>((resolve, reject) => {
          readv(fd, [b1, b2], 0, (err, bytesRead) => {
            if (err) return reject(err);
            expect(bytesRead).toBe(5);
            expect(b1.toString()).toBe('ab');
            expect(b2.toString()).toBe('cde');
            resolve();
          });
        });
      } finally {
        closeSync(fd);
        unlinkSync(f);
      }
    });

    await it('writev writes multiple buffers', async () => {
      const f = tmpFile('writev', '------');
      const fd = openSync(f, 'r+');
      try {
        const b1 = Buffer.from('AB');
        const b2 = Buffer.from('CDE');
        await new Promise<void>((resolve, reject) => {
          writev(fd, [b1, b2], 0, (err, bytesWritten) => {
            if (err) return reject(err);
            expect(bytesWritten).toBe(5);
            resolve();
          });
        });
        closeSync(fd);
        expect(readFileSync(f, 'utf8').slice(0, 5)).toBe('ABCDE');
      } finally {
        unlinkSync(f);
      }
    });

    await it('exists returns true for existing path, false for missing', async () => {
      const f = tmpFile('exists', 'e');
      const existing = await new Promise<boolean>((resolve) => {
        exists(f, (v) => resolve(v));
      });
      expect(existing).toBe(true);
      const missing = await new Promise<boolean>((resolve) => {
        exists(join(TMP, 'gjsify-nonexistent-xyz-123'), (v) => resolve(v));
      });
      expect(missing).toBe(false);
      unlinkSync(f);
    });

    await it('openAsBlob returns Blob with correct size', async () => {
      const f = tmpFile('blob', 'blobdata');
      const blob = await openAsBlob(f);
      expect(blob.size).toBe(8);
      expect(blob instanceof Blob).toBe(true);
      unlinkSync(f);
    });
  });
};
