// Sign/Verify — stub pending native TypeScript reimplementation
// TODO: Reimplement RSA/ECDSA signing using refs/browserify-sign as reference

function notImplemented(name: string): never {
  throw new Error(`crypto.${name}() is not yet implemented for GJS. See refs/browserify-sign/ for reference.`);
}

export function createSign(_algorithm: string): any {
  notImplemented('createSign');
}

export function createVerify(_algorithm: string): any {
  notImplemented('createVerify');
}
