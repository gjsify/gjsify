// Shared filesystem utilities for GJS — original implementation using Gio

import { fileURLToPath, URL as NodeURL } from 'node:url';

import type { PathLike } from 'node:fs';

// Gio.File.new_for_path only accepts strings; convert URL/Buffer accordingly.
export function normalizePath(path: PathLike): string {
    if (path instanceof URL || path instanceof NodeURL) return fileURLToPath(path as URL);
    if (typeof path === 'string') return path;
    return (path as Buffer).toString();
}

const CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function randomName(): string {
    return [...Array(6)].map(() => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}
