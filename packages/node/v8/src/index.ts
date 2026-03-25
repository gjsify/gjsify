// Reference: Node.js lib/v8.js — stub for GJS

export function getHeapStatistics(): Record<string, number> {
  return {
    total_heap_size: 0,
    total_heap_size_executable: 0,
    total_physical_size: 0,
    total_available_size: 0,
    used_heap_size: 0,
    heap_size_limit: 0,
    malloced_memory: 0,
    peak_malloced_memory: 0,
    does_zap_garbage: 0,
    number_of_native_contexts: 0,
    number_of_detached_contexts: 0,
    external_memory: 0,
  };
}

export function getHeapSpaceStatistics(): any[] {
  return [];
}

export function setFlagsFromString(_flags: string): void {}

export function getHeapSnapshot(): any {
  return null;
}

export function writeHeapSnapshot(_filename?: string): string {
  return '';
}

export function getHeapCodeStatistics(): Record<string, number> {
  return {
    code_and_metadata_size: 0,
    bytecode_and_metadata_size: 0,
    external_script_source_size: 0,
    cpu_profiler_metadata_size: 0,
  };
}

export function serialize(value: any): Buffer {
  return Buffer.from(JSON.stringify(value));
}

export function deserialize(buffer: Buffer): any {
  return JSON.parse(buffer.toString());
}

export default {
  getHeapStatistics,
  getHeapSpaceStatistics,
  setFlagsFromString,
  getHeapSnapshot,
  writeHeapSnapshot,
  getHeapCodeStatistics,
  serialize,
  deserialize,
};
