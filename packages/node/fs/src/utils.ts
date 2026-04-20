// Shared filesystem utilities for GJS — original implementation using Gio

import { existsSync } from './sync.js';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import type { PathLike } from 'node:fs';

/**
 * Node's fs accepts `string`, `Buffer` and `URL` (file:// scheme) for path
 * arguments. GJS's `Gio.File.new_for_path` only accepts strings, so every
 * public fs entry point funnels its `path` through this helper.
 *
 * - `URL` → converted via `fileURLToPath` (throws for non-file: schemes).
 * - `Buffer` → decoded as UTF-8 (matches Node's Linux behaviour).
 * - `string` → returned as-is.
 */
export function normalizePath(path: PathLike): string {
  if (path instanceof URL || path instanceof NodeURL) {
    return fileURLToPath(path as URL);
  }
  if (typeof path === 'string') return path;
  // Buffer / typed array
  return (path as Buffer).toString();
}

const CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function randomName(): string {
  return [...Array(6)].map(() =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join("");
}

// credits: https://github.com/denoland/deno_std/blob/63be40277264e71af60f9b118a2cb569e02beeab/node/_fs/_fs_mkdtemp.ts#L98
export function tempDirPath(prefix: string): string {
  let path: string;
  do {
    path = prefix + randomName();
  } while (existsSync(path));

  return path;
}