import { existsSync } from './sync.js';

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