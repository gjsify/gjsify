// Tests for stream/promises module
// Reference: Node.js lib/stream/promises.js

import { describe, it, expect } from '@gjsify/unit';
import { Readable, Writable, Transform, PassThrough } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';

export default async () => {
  await describe('stream/promises', async () => {

    // ==================== pipeline() ====================
    await describe('pipeline', async () => {
      await it('should pipe readable to writable', async () => {
        const chunks: string[] = [];
        const source = Readable.from(['hello', ' ', 'pipeline']);
        const sink = new Writable({
          write(chunk, _enc, cb) {
            chunks.push(chunk.toString());
            cb();
          },
        });

        await pipeline(source, sink);
        expect(chunks.join('')).toBe('hello pipeline');
      });

      await it('should pipe through a transform', async () => {
        const source = Readable.from(['hello']);
        const transform = new Transform({
          transform(chunk, _enc, cb) {
            cb(null, chunk.toString().toUpperCase());
          },
        });
        const chunks: string[] = [];
        const sink = new Writable({
          write(chunk, _enc, cb) {
            chunks.push(chunk.toString());
            cb();
          },
        });

        await pipeline(source, transform, sink);
        expect(chunks.join('')).toBe('HELLO');
      });

      await it('should reject on source error', async () => {
        const source = new Readable({
          read() {
            this.destroy(new Error('source error'));
          },
        });
        const sink = new Writable({
          write(_chunk, _enc, cb) { cb(); },
        });

        let caught = false;
        try {
          await pipeline(source, sink);
        } catch (err: any) {
          caught = true;
          expect(err.message).toBe('source error');
        }
        expect(caught).toBe(true);
      });

      await it('should pipe through PassThrough', async () => {
        const source = Readable.from(['pass', 'through']);
        const pt = new PassThrough();
        const chunks: string[] = [];
        const sink = new Writable({
          write(chunk, _enc, cb) {
            chunks.push(chunk.toString());
            cb();
          },
        });

        await pipeline(source, pt, sink);
        expect(chunks.join('')).toBe('passthrough');
      });
    });

    // ==================== finished() ====================
    await describe('finished', async () => {
      await it('should resolve when writable finishes', async () => {
        const writable = new Writable({
          write(_chunk, _enc, cb) { cb(); },
        });

        const p = finished(writable);
        writable.end('done');
        await p;
        // If we get here, it resolved successfully
        expect(true).toBe(true);
      });

      await it('should resolve when readable ends', async () => {
        const readable = Readable.from(['data']);

        // Consume the stream
        readable.resume();
        await finished(readable);
        expect(true).toBe(true);
      });

      await it('should reject on stream error', async () => {
        const readable = new Readable({
          read() {
            this.destroy(new Error('stream error'));
          },
        });

        let caught = false;
        try {
          readable.resume();
          await finished(readable);
        } catch (err: any) {
          caught = true;
          expect(err.message).toBe('stream error');
        }
        expect(caught).toBe(true);
      });

      await it('should resolve for already destroyed stream', async () => {
        const writable = new Writable({
          write(_chunk, _enc, cb) { cb(); },
        });
        writable.end();

        // Wait for finish event
        await new Promise<void>((resolve) => {
          writable.on('finish', resolve);
        });

        // finished should resolve immediately or quickly for already-finished streams
        await finished(writable);
        expect(true).toBe(true);
      });
    });
  });
};
