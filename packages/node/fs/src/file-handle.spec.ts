// Ported from refs/node-test/parallel/test-fs-promises-file-handle-*.js
// Original: MIT license, Node.js contributors
import { describe, it, expect } from '@gjsify/unit';
import { promises, mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';

export default async () => {
  await describe('FileHandle', async () => {
    await it('should open a file for writing and return correct bytesWritten', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fs-fh-'));
      const path = join(dir, 'write.txt');
      const fh = await promises.open(path, 'w+', 0o666);
      const buf = Buffer.from('Hello World', 'utf8');
      const res = await fh.write(buf, 0, buf.length, 0);
      expect(res.bytesWritten).toBe(buf.length);
      expect(res.buffer).toBe(buf);
      await fh.close();
      await promises.rm(path);
      rmdirSync(dir);
    });

    await it('should read back written content via read()', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fs-fh-read-'));
      const path = join(dir, 'rw.txt');
      const fh = await promises.open(path, 'w+');
      const written = Buffer.from('Read back test');
      await fh.write(written, 0, written.length, 0);

      const readBuf = Buffer.alloc(written.length);
      const { bytesRead } = await fh.read(readBuf, 0, written.length, 0);
      expect(bytesRead).toBe(written.length);
      expect(readBuf.toString()).toBe('Read back test');

      await fh.close();
      await promises.rm(path);
      rmdirSync(dir);
    });

    await it('should read entire file via readFile()', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fs-fh-rf-'));
      const path = join(dir, 'rf.txt');
      await promises.writeFile(path, 'FileHandle readFile content');
      const fh = await promises.open(path, 'r');
      const content = await fh.readFile({ encoding: 'utf8' });
      expect(content).toBe('FileHandle readFile content');
      await fh.close();
      await promises.rm(path);
      rmdirSync(dir);
    });

    await it('should stat the opened file', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fs-fh-stat-'));
      const path = join(dir, 'stat.txt');
      await promises.writeFile(path, 'stat content');
      const fh = await promises.open(path, 'r');
      const s = await fh.stat();
      expect(s.isFile()).toBe(true);
      expect(s.size).toBeGreaterThan(0);
      await fh.close();
      await promises.rm(path);
      rmdirSync(dir);
    });

    await it('should truncate the file via truncate()', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fs-fh-trunc-'));
      const path = join(dir, 'trunc.txt');
      await promises.writeFile(path, 'Hello World Truncate');
      const fh = await promises.open(path, 'r+');
      await fh.truncate(5);
      await fh.close();
      const content = await promises.readFile(path, { encoding: 'utf8' });
      expect(content).toBe('Hello');
      await promises.rm(path);
      rmdirSync(dir);
    });

    await it('should append content via appendFile()', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fs-fh-app-'));
      const path = join(dir, 'append.txt');
      await promises.writeFile(path, 'start');
      const fh = await promises.open(path, 'a');
      await fh.appendFile(' appended');
      await fh.close();
      const content = await promises.readFile(path, { encoding: 'utf8' });
      expect(content).toBe('start appended');
      await promises.rm(path);
      rmdirSync(dir);
    });

    await it('should throw when opening a non-existent file for reading', async () => {
      let threw = false;
      try {
        await promises.open('/nonexistent/path/abc123.txt', 'r');
      } catch (e: unknown) {
        threw = true;
        expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
      expect(threw).toBe(true);
    });

    await it('should writeFile via FileHandle', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fs-fh-wf-'));
      const path = join(dir, 'wf.txt');
      const fh = await promises.open(path, 'w');
      await fh.writeFile('written via FileHandle.writeFile');
      await fh.close();
      const content = await promises.readFile(path, { encoding: 'utf8' });
      expect(content).toBe('written via FileHandle.writeFile');
      await promises.rm(path);
      rmdirSync(dir);
    });
  });
};
