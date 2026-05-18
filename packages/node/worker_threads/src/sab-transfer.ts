// SPDX-License-Identifier: MIT
// SharedBuffer transfer helpers for cross-process Worker.postMessage().
//
// Pairs with @gjsify/sab-native's FdChannel: the parent walks a value tree
// for SharedBuffer instances, builds a placeholder map keyed by a
// sequence-allocated tag, sends each fd over the SCM_RIGHTS side-channel,
// and emits a JSON message with {__sab: tag, size: N} placeholders in
// place of every SharedBuffer instance. The child bootstrap's recv-loop
// drains fds from fd 3 into a Map<tag, fd>, then materialises each
// placeholder into `SharedBuffer.fromFd(fd, size)` before dispatching the
// message.
//
// In-process MessageChannel (same-process MessagePort.postMessage) doesn't
// need any of this — both ports share the same JS heap, so a SharedBuffer
// instance is "transferred" by reference. The in-process path goes
// through structuredClone (with our SharedBuffer pass-through branch) and
// the message-port.ts transfer-list validation.

import type { SharedBuffer } from '@gjsify/sab-native';

/**
 * Placeholder for a SharedBuffer instance that has been transferred
 * cross-process. The receiver reconstructs a SharedBuffer from the
 * incoming fd indexed by `__sab` (the tag the sender attached to the
 * SCM_RIGHTS message), with the original byteLength.
 */
export interface SharedBufferPlaceholder {
  readonly __sab: number;
  readonly size: number;
}

export function isSharedBufferPlaceholder(value: unknown): value is SharedBufferPlaceholder {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as { __sab?: unknown }).__sab === 'number'
    && typeof (value as { size?: unknown }).size === 'number'
  );
}

/**
 * Detect a SharedBuffer instance without holding a hard runtime reference
 * to the constructor — keeps the check resilient when sab-native's
 * prebuild is unavailable (the import resolves but the class never gets
 * instantiated) and avoids paying the typelib load just to typecheck a
 * message payload.
 */
export function isSharedBuffer(value: unknown): value is SharedBuffer {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { constructor?: { name?: string } }).constructor?.name === 'SharedBuffer'
  );
}

/**
 * Walk `value`, replace every SharedBuffer instance with a placeholder
 * carrying a freshly-allocated tag, and return the substituted tree
 * alongside the table of (tag, SharedBuffer) pairs the caller must send
 * over the SCM_RIGHTS side-channel before the JSON message itself.
 *
 * The walker handles plain objects + arrays. Other tagged types
 * (Map, Set, …) are passed through unchanged — same constraint Node
 * applies to its in-built clone walker.
 *
 * Tags start at `startTag` and increment per discovery. Callers should
 * thread a per-Worker sequence counter so tags stay unique within a
 * single FdChannel pair's lifetime (4 G tags = 2³² = plenty).
 */
export function extractSharedBuffers(
  value: unknown,
  startTag: number,
): { value: unknown; table: { tag: number; buffer: SharedBuffer }[]; nextTag: number } {
  const table: { tag: number; buffer: SharedBuffer }[] = [];
  const bufferToTag = new Map<SharedBuffer, number>();
  let nextTag = startTag;

  function walk(v: unknown, seen: Map<object, unknown>): unknown {
    if (v === null || typeof v !== 'object') return v;

    if (isSharedBuffer(v)) {
      let tag = bufferToTag.get(v);
      if (tag === undefined) {
        tag = nextTag++;
        bufferToTag.set(v, tag);
        table.push({ tag, buffer: v });
      }
      const placeholder: SharedBufferPlaceholder = { __sab: tag, size: v.byteLength };
      return placeholder;
    }

    if (seen.has(v)) return seen.get(v);

    if (Array.isArray(v)) {
      const out: unknown[] = [];
      seen.set(v, out);
      for (let i = 0; i < v.length; i++) {
        if (i in v) out[i] = walk(v[i], seen);
      }
      return out;
    }

    const tag = Object.prototype.toString.call(v).slice(8, -1);
    if (tag === 'Object') {
      const out: Record<string, unknown> = {};
      seen.set(v, out);
      for (const k of Object.keys(v as Record<string, unknown>)) {
        out[k] = walk((v as Record<string, unknown>)[k], seen);
      }
      return out;
    }

    return v;
  }

  const substituted = walk(value, new Map());
  return { value: substituted, table, nextTag };
}

/**
 * Receiver-side counterpart: walk a tree that may contain
 * SharedBufferPlaceholder leaves and replace each with the corresponding
 * SharedBuffer reconstructed from the fdMap. Mutates the input in place
 * (callers always work on a freshly-parsed JSON tree, so this avoids an
 * extra copy).
 *
 * If a placeholder references a tag that is not yet in `fdMap`, the
 * caller should buffer the message and retry once the recv-loop fills
 * the missing entry. In the current protocol the sender always
 * sends fds before the JSON line, so the map is populated by the time
 * the JSON arrives — but the bootstrap layer is responsible for that
 * ordering.
 */
export function materializeSharedBuffers(
  value: unknown,
  resolveTag: (tag: number, size: number) => SharedBuffer,
): unknown {
  function walk(v: unknown, seen: Map<object, unknown>): unknown {
    if (v === null || typeof v !== 'object') return v;
    if (isSharedBufferPlaceholder(v)) {
      return resolveTag(v.__sab, v.size);
    }
    if (seen.has(v)) return seen.get(v);

    if (Array.isArray(v)) {
      seen.set(v, v);
      for (let i = 0; i < v.length; i++) {
        if (i in v) v[i] = walk(v[i], seen);
      }
      return v;
    }

    const tag = Object.prototype.toString.call(v).slice(8, -1);
    if (tag === 'Object') {
      seen.set(v, v);
      for (const k of Object.keys(v as Record<string, unknown>)) {
        (v as Record<string, unknown>)[k] = walk((v as Record<string, unknown>)[k], seen);
      }
      return v;
    }
    return v;
  }

  return walk(value, new Map());
}
