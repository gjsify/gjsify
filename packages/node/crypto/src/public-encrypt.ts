// RSA public-key encryption — stub pending native TypeScript reimplementation
// TODO: Reimplement RSA using refs/public-encrypt as reference

function notImplemented(name: string): never {
  throw new Error(`crypto.${name}() is not yet implemented for GJS. See refs/public-encrypt/ for reference.`);
}

export function publicEncrypt(_key: any, _buffer: Buffer | Uint8Array): Buffer {
  notImplemented('publicEncrypt');
}

export function privateDecrypt(_key: any, _buffer: Buffer | Uint8Array): Buffer {
  notImplemented('privateDecrypt');
}

export function privateEncrypt(_key: any, _buffer: Buffer | Uint8Array): Buffer {
  notImplemented('privateEncrypt');
}

export function publicDecrypt(_key: any, _buffer: Buffer | Uint8Array): Buffer {
  notImplemented('publicDecrypt');
}
