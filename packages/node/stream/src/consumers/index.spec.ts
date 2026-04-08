// Tests for stream/consumers module
// Reference: Node.js lib/stream/consumers.js

import { describe, it, expect } from '@gjsify/unit';
import { Readable } from 'node:stream';
import { text, json, buffer, arrayBuffer, blob } from 'node:stream/consumers';

export default async () => {
  await describe('stream/consumers', async () => {

    // ==================== text() ====================
    await describe('text', async () => {
      await it('should consume stream as text', async () => {
        const stream = Readable.from(['Hello', ' ', 'World']);
        const result = await text(stream);
        expect(result).toBe('Hello World');
      });

      await it('should handle empty stream', async () => {
        const stream = Readable.from([]);
        const result = await text(stream);
        expect(result).toBe('');
      });

      await it('should handle single chunk', async () => {
        const stream = Readable.from(['single']);
        const result = await text(stream);
        expect(result).toBe('single');
      });
    });

    // ==================== json() ====================
    await describe('json', async () => {
      await it('should consume stream as JSON', async () => {
        const stream = Readable.from(['{"key":', '"value"}']);
        const result = await json(stream) as { key: string };
        expect(result.key).toBe('value');
      });

      await it('should parse JSON array', async () => {
        const stream = Readable.from(['[1,2,3]']);
        const result = await json(stream) as number[];
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(3);
        expect(result[0]).toBe(1);
      });

      await it('should parse JSON number', async () => {
        const stream = Readable.from(['42']);
        const result = await json(stream);
        expect(result).toBe(42);
      });
    });

    // ==================== buffer() ====================
    await describe('buffer', async () => {
      await it('should consume stream as Uint8Array', async () => {
        const stream = Readable.from(['Hello']);
        const result = await buffer(stream);
        expect(result instanceof Uint8Array).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      });

      await it('should handle empty stream', async () => {
        const stream = Readable.from([]);
        const result = await buffer(stream);
        expect(result instanceof Uint8Array).toBe(true);
        expect(result.length).toBe(0);
      });
    });

    // ==================== arrayBuffer() ====================
    await describe('arrayBuffer', async () => {
      await it('should consume stream as ArrayBuffer', async () => {
        const stream = Readable.from(['Hello']);
        const result = await arrayBuffer(stream);
        expect(result instanceof ArrayBuffer).toBe(true);
        expect(result.byteLength).toBeGreaterThan(0);
      });

      await it('should handle multiple chunks', async () => {
        const stream = Readable.from(['AB', 'CD']);
        const result = await arrayBuffer(stream);
        const view = new Uint8Array(result);
        const str = new TextDecoder().decode(view);
        expect(str).toBe('ABCD');
      });
    });

    // ==================== blob() ====================
    await describe('blob', async () => {
      await it('should consume stream as Blob', async () => {
        const stream = Readable.from(['Hello Blob']);
        const result = await blob(stream);
        expect(result instanceof Blob).toBe(true);
        expect(result.size).toBeGreaterThan(0);
      });

      await it('should have correct content', async () => {
        const stream = Readable.from(['test']);
        const result = await blob(stream);
        const t = await result.text();
        expect(t).toBe('test');
      });
    });
  });
};
