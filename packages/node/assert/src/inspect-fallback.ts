// Minimal inspect fallback for GJS — original implementation

/**
 * Minimal value-to-string converter for assertion error messages.
 * This avoids depending on util.inspect (which itself depends on @gjsify/deno_std).
 * Can be replaced with util.inspect once @gjsify/util is migrated.
 */

const MAX_DEPTH = 3;
const MAX_ARRAY_LENGTH = 10;
const MAX_STRING_LENGTH = 128;

export function safeInspect(value: unknown, depth: number = MAX_DEPTH): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  switch (typeof value) {
    case 'string':
      if (value.length > MAX_STRING_LENGTH) {
        return `'${value.slice(0, MAX_STRING_LENGTH)}...'`;
      }
      return `'${value}'`;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function: ${value.name || 'anonymous'}]`;
    case 'object':
      return inspectObject(value, depth);
  }

  return String(value);
}

function inspectObject(obj: object, depth: number, seen: WeakSet<object> = new WeakSet()): string {
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof RegExp) return obj.toString();
  if (obj instanceof Error) return `[${obj.constructor.name}: ${obj.message}]`;

  if (obj instanceof Map) {
    if (depth <= 0) return `Map(${obj.size}) { ... }`;
    const entries = [...obj.entries()]
      .slice(0, MAX_ARRAY_LENGTH)
      .map(([k, v]) => `${inspectInner(k, depth - 1, seen)} => ${inspectInner(v, depth - 1, seen)}`);
    const suffix = obj.size > MAX_ARRAY_LENGTH ? ', ...' : '';
    return `Map(${obj.size}) { ${entries.join(', ')}${suffix} }`;
  }

  if (obj instanceof Set) {
    if (depth <= 0) return `Set(${obj.size}) { ... }`;
    const entries = [...obj.values()]
      .slice(0, MAX_ARRAY_LENGTH)
      .map(v => inspectInner(v, depth - 1, seen));
    const suffix = obj.size > MAX_ARRAY_LENGTH ? ', ...' : '';
    return `Set(${obj.size}) { ${entries.join(', ')}${suffix} }`;
  }

  if (ArrayBuffer.isView(obj)) {
    const typedName = obj.constructor.name;
    const arr = obj instanceof DataView
      ? new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength)
      : obj as unknown as ArrayLike<number>;
    const len = 'length' in arr ? (arr as ArrayLike<number>).length : 0;
    const shown = Math.min(len, MAX_ARRAY_LENGTH);
    const items: string[] = [];
    for (let i = 0; i < shown; i++) items.push(String((arr as ArrayLike<number>)[i]));
    const suffix = len > MAX_ARRAY_LENGTH ? ', ...' : '';
    return `${typedName}(${len}) [ ${items.join(', ')}${suffix} ]`;
  }

  if (Array.isArray(obj)) {
    if (depth <= 0) return `[ ... ]`;
    const shown = obj.slice(0, MAX_ARRAY_LENGTH)
      .map(v => inspectInner(v, depth - 1, seen));
    const suffix = obj.length > MAX_ARRAY_LENGTH ? ', ...' : '';
    return `[ ${shown.join(', ')}${suffix} ]`;
  }

  // Plain object
  if (depth <= 0) return '{ ... }';
  const keys = Object.keys(obj);
  const entries = keys.slice(0, MAX_ARRAY_LENGTH)
    .map(k => `${k}: ${inspectInner((obj as Record<string, unknown>)[k], depth - 1, seen)}`);
  const suffix = keys.length > MAX_ARRAY_LENGTH ? ', ...' : '';
  const prefix = obj.constructor && obj.constructor.name !== 'Object'
    ? `${obj.constructor.name} ` : '';
  return `${prefix}{ ${entries.join(', ')}${suffix} }`;
}

function inspectInner(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return inspectObject(value, depth, seen);
  return safeInspect(value, depth);
}
