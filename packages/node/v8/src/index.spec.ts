// Ported from refs/node-test/parallel/test-v8-stats.js,
//   refs/node-test/parallel/test-v8-serdes.js,
//   refs/node-test/parallel/test-v8-deserialize-buffer.js
// Original: MIT, Node.js contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import {
  getHeapStatistics,
  getHeapCodeStatistics,
  getHeapSpaceStatistics,
  serialize,
  deserialize,
  Serializer,
  Deserializer,
  DefaultSerializer,
  DefaultDeserializer,
  isStringOneByteRepresentation,
  GCProfiler,
  startCpuProfile,
} from 'node:v8';

export default async () => {
  await describe('v8.getHeapStatistics', async () => {
    await it('returns an object with all 14 required fields', async () => {
      const stats = getHeapStatistics();
      const fields = [
        'total_heap_size',
        'total_heap_size_executable',
        'total_physical_size',
        'total_available_size',
        'used_heap_size',
        'heap_size_limit',
        'malloced_memory',
        'peak_malloced_memory',
        'does_zap_garbage',
        'number_of_native_contexts',
        'number_of_detached_contexts',
        'total_global_handles_size',
        'used_global_handles_size',
        'external_memory',
      ];
      for (const field of fields) {
        expect(typeof (stats as any)[field]).toBe('number');
      }
    });

    await it('used_heap_size is a positive number on Linux (via /proc)', async () => {
      const stats = getHeapStatistics();
      expect(stats.used_heap_size).toBeGreaterThan(0);
    });
  });

  await describe('v8.getHeapCodeStatistics', async () => {
    await it('returns object with 4 numeric fields', async () => {
      const stats = getHeapCodeStatistics() as any;
      expect(typeof stats.code_and_metadata_size).toBe('number');
      expect(typeof stats.bytecode_and_metadata_size).toBe('number');
      expect(typeof stats.external_script_source_size).toBe('number');
      expect(typeof stats.cpu_profiler_metadata_size).toBe('number');
    });
  });

  await describe('v8.getHeapSpaceStatistics', async () => {
    await it('returns an array', async () => {
      expect(Array.isArray(getHeapSpaceStatistics())).toBe(true);
    });
  });

  await describe('v8.serialize / v8.deserialize round-trips', async () => {
    await it('null', async () => {
      expect(deserialize(serialize(null))).toBe(null);
    });

    await it('undefined', async () => {
      expect(deserialize(serialize(undefined))).toBe(undefined);
    });

    await it('boolean true', async () => {
      expect(deserialize(serialize(true))).toBe(true);
    });

    await it('boolean false', async () => {
      expect(deserialize(serialize(false))).toBe(false);
    });

    await it('integer', async () => {
      expect(deserialize(serialize(42))).toBe(42);
    });

    await it('negative integer', async () => {
      expect(deserialize(serialize(-7))).toBe(-7);
    });

    await it('float', async () => {
      expect(deserialize(serialize(3.14))).toBe(3.14);
    });

    await it('ASCII string', async () => {
      expect(deserialize(serialize('hello'))).toBe('hello');
    });

    await it('Unicode string', async () => {
      expect(deserialize(serialize('héllo wörld'))).toBe('héllo wörld');
    });

    await it('Date', async () => {
      const d = new Date('2020-01-01T00:00:00Z');
      const result = deserialize(serialize(d)) as Date;
      expect(result instanceof Date).toBe(true);
      expect(result.getTime()).toBe(d.getTime());
    });

    await it('plain object', async () => {
      const obj = { a: 1, b: 'two', c: true };
      const result = deserialize(serialize(obj)) as typeof obj;
      expect(result.a).toBe(1);
      expect(result.b).toBe('two');
      expect(result.c).toBe(true);
    });

    await it('array', async () => {
      const arr = [1, 'two', null, true];
      const result = deserialize(serialize(arr)) as typeof arr;
      expect(result[0]).toBe(1);
      expect(result[1]).toBe('two');
      expect(result[2]).toBe(null);
      expect(result[3]).toBe(true);
    });

    await it('Uint8Array', async () => {
      const ta = new Uint8Array([1, 2, 3]);
      const result = deserialize(serialize(ta)) as Uint8Array;
      expect(result instanceof Uint8Array).toBe(true);
      expect(result[0]).toBe(1);
      expect(result[1]).toBe(2);
      expect(result[2]).toBe(3);
    });

    await it('Int32Array', async () => {
      const ta = new Int32Array([-1, 0, 1]);
      const result = deserialize(serialize(ta)) as Int32Array;
      expect(result instanceof Int32Array).toBe(true);
      expect(result[0]).toBe(-1);
      expect(result[2]).toBe(1);
    });

    await it('Float64Array', async () => {
      const ta = new Float64Array([1.1, 2.2, 3.3]);
      const result = deserialize(serialize(ta)) as Float64Array;
      expect(result instanceof Float64Array).toBe(true);
      expect(Math.abs(result[0] - 1.1) < 1e-9).toBe(true);
    });

    await it('Buffer', async () => {
      const buf = Buffer.from([10, 20, 30]);
      const result = deserialize(serialize(buf)) as Buffer;
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result[0]).toBe(10);
      expect(result[2]).toBe(30);
    });

    await it('BigInt', async () => {
      const big = 9007199254740993n;
      expect(deserialize(serialize(big))).toBe(big);
    });

    await it('negative BigInt', async () => {
      expect(deserialize(serialize(-42n))).toBe(-42n);
    });

    await it('circular object produces backref on deserialize', async () => {
      const obj: any = { a: 1 };
      obj.self = obj;
      const result = deserialize(serialize(obj)) as any;
      expect(result.a).toBe(1);
      expect(result.self).toBe(result);
    });
  });

  await describe('v8.Serializer / Deserializer classes', async () => {
    await it('Serializer can write header + value → Buffer', async () => {
      const s = new Serializer();
      s.writeHeader();
      s.writeValue(42);
      const buf = s.releaseBuffer();
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(0);
    });

    await it('Deserializer can read header + value', async () => {
      const s = new Serializer();
      s.writeHeader();
      s.writeValue('test');
      const buf = s.releaseBuffer();

      const d = new Deserializer(buf);
      d.readHeader();
      expect(d.readValue()).toBe('test');
    });

    await it('getWireFormatVersion returns 15', async () => {
      const s = new Serializer();
      s.writeHeader();
      s.writeValue(null);
      const buf = s.releaseBuffer();
      const d = new Deserializer(buf);
      d.readHeader();
      expect(d.getWireFormatVersion()).toBe(15);
    });
  });

  await describe('v8.DefaultSerializer / DefaultDeserializer', async () => {
    await it('TypedArray host-object round-trip', async () => {
      const original = new Uint32Array([100, 200, 300]);
      const s = new DefaultSerializer();
      s.writeHeader();
      s.writeValue(original);
      const buf = s.releaseBuffer();

      const d = new DefaultDeserializer(buf);
      d.readHeader();
      const result = d.readValue() as Uint32Array;
      expect(result instanceof Uint32Array).toBe(true);
      expect(result[0]).toBe(100);
      expect(result[1]).toBe(200);
      expect(result[2]).toBe(300);
    });
  });

  await describe('v8.isStringOneByteRepresentation', async () => {
    await it('ASCII string returns true', async () => {
      expect(isStringOneByteRepresentation('hello')).toBe(true);
    });

    await it('string with ü (>255 codepoint) returns false', async () => {
      // ü = U+00FC (fits in Latin-1), 日 = U+65E5 (does not)
      expect(isStringOneByteRepresentation('日本語')).toBe(false);
    });

    await it('empty string returns true', async () => {
      expect(isStringOneByteRepresentation('')).toBe(true);
    });
  });

  await describe('v8.GCProfiler', async () => {
    await it('start/stop returns defined object with version and timing', async () => {
      const profiler = new GCProfiler();
      profiler.start();
      const stats = profiler.stop() as any;
      expect(stats).toBeDefined();
      expect(stats.version).toBe(1);
      expect(typeof stats.startTime).toBe('number');
      expect(typeof stats.endTime).toBe('number');
    });

    await it('stop without start returns undefined', async () => {
      const profiler = new GCProfiler();
      expect(profiler.stop()).toBe(undefined);
    });
  });

  await describe('v8.startCpuProfile', async () => {
    await it('returns an object with a stop() method that does not throw', async () => {
      const handle = startCpuProfile();
      expect(typeof handle.stop).toBe('function');
      expect(() => handle.stop()).not.toThrow();
    });
  });
};
