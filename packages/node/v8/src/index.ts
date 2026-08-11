// Reference: Node.js lib/v8.js
// Reimplemented for GJS — heap stats via a per-platform process-memory reader
// (`./heap/`), serialization via the V8 wire format

import { getHeapStatistics } from './heap/index.js';
import { Serializer, Deserializer, DefaultSerializer, DefaultDeserializer } from './serdes.js';

export { getHeapStatistics };
export { Serializer, Deserializer, DefaultSerializer, DefaultDeserializer };

export function serialize(value: unknown): Buffer {
    const ser = new DefaultSerializer();
    ser.writeHeader();
    ser.writeValue(value);
    return ser.releaseBuffer();
}

export function deserialize(buffer: NodeJS.ArrayBufferView | ArrayBuffer): unknown {
    const des = new DefaultDeserializer(buffer);
    des.readHeader();
    return des.readValue();
}

export interface HeapSpaceInfo {
    space_name: string;
    space_size: number;
    space_used_size: number;
    space_available_size: number;
    physical_space_size: number;
}

export function getHeapSpaceStatistics(): HeapSpaceInfo[] {
    return [];
}

export function getHeapCodeStatistics(): {
    code_and_metadata_size: number;
    bytecode_and_metadata_size: number;
    external_script_source_size: number;
    cpu_profiler_metadata_size: number;
} {
    return {
        code_and_metadata_size: 0,
        bytecode_and_metadata_size: 0,
        external_script_source_size: 0,
        cpu_profiler_metadata_size: 0,
    };
}

export function setFlagsFromString(_flags: string): void {}

export function getHeapSnapshot(_options?: object): null {
    return null;
}

export function writeHeapSnapshot(_filename?: string): string {
    return '';
}

export function isStringOneByteRepresentation(content: string): boolean {
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) > 255) return false;
    }
    return true;
}

export class GCProfiler {
    #running = false;
    #startTime = 0;

    start(): void {
        if (this.#running) return;
        this.#running = true;
        this.#startTime = Date.now();
    }

    stop(): { version: number; startTime: number; endTime: number; stats: never[] } | undefined {
        if (!this.#running) return undefined;
        this.#running = false;
        try {
            // GJS legacy `imports.system` (`gc()` triggers a SpiderMonkey GC).
            // Read through a typed view rather than `(globalThis as any).imports`.
            interface _GjsImportsHost {
                imports?: { system?: { gc?: () => void } };
            }
            const system = (globalThis as unknown as _GjsImportsHost).imports?.system;
            if (typeof system?.gc === 'function') system.gc();
        } catch {
            /* ignore */
        }
        return { version: 1, startTime: this.#startTime, endTime: Date.now(), stats: [] };
    }

    [Symbol.dispose](): void {
        this.stop();
    }
}

export class SyncCPUProfileHandle {
    stop(): undefined {
        return undefined;
    }
    [Symbol.dispose](): void {
        this.stop();
    }
}

export function startCpuProfile(): SyncCPUProfileHandle {
    return new SyncCPUProfileHandle();
}

export default {
    getHeapStatistics,
    getHeapSpaceStatistics,
    getHeapCodeStatistics,
    setFlagsFromString,
    getHeapSnapshot,
    writeHeapSnapshot,
    serialize,
    deserialize,
    isStringOneByteRepresentation,
    Serializer,
    Deserializer,
    DefaultSerializer,
    DefaultDeserializer,
    GCProfiler,
    startCpuProfile,
};
