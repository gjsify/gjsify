// Diffie-Hellman key exchange for GJS
// Reference: Node.js lib/internal/crypto/diffiehellman.js, refs/diffie-hellman/lib/dh.js
// Reimplemented for GJS using native BigInt (ES2024)
// Predefined groups from RFC 2409 (modp1, modp2) and RFC 3526 (modp5, modp14-modp18)

import { Buffer } from 'buffer';
import { randomBytes } from './random.js';

// ---------------------------------------------------------------------------
// Predefined MODP groups (RFC 2409 Section 6.1-6.2, RFC 3526 Sections 2-7)
// All generators are 2.
// ---------------------------------------------------------------------------

const PREDEFINED_GROUPS: Record<string, { gen: string; prime: string }> = {
  // RFC 2409 Section 6.1 — 768-bit MODP Group
  modp1: {
    gen: '02',
    prime:
      'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
      '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
      'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
      'e485b576625e7ec6f44c42e9a63a36' +
      '20ffffffffffffffff',
  },
  // RFC 2409 Section 6.2 — 1024-bit MODP Group
  modp2: {
    gen: '02',
    prime:
      'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
      '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
      'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
      'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
      'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece65381' +
      'ffffffffffffffff',
  },
  // RFC 3526 Section 2 — 1536-bit MODP Group
  modp5: {
    gen: '02',
    prime:
      'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
      '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
      'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
      'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
      'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
      'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
      '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
      '670c354e4abc9804f1746c08ca237327' +
      'ffffffffffffffff',
  },
  // RFC 3526 Section 3 — 2048-bit MODP Group
  modp14: {
    gen: '02',
    prime:
      'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
      '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
      'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
      'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
      'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
      'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
      '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
      '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
      'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
      'de2bcbf6955817183995497cea956ae515d2261898fa05101' +
      '5728e5a8aacaa68ffffffffffffffff',
  },
  // RFC 3526 Section 4 — 3072-bit MODP Group
  modp15: {
    gen: '02',
    prime:
      'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
      '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
      'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
      'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
      'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
      'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
      '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
      '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
      'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
      'de2bcbf6955817183995497cea956ae515d2261898fa05101' +
      '5728e5a8aaac42dad33170d04507a33a85521abdf1cba64e' +
      'cfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7a' +
      'bf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf' +
      '12ffa06d98a0864d87602733ec86a64521f2b18177b200cb' +
      'be117577a615d6c770988c0bad946e208e24fa074e5ab314' +
      '3db5bfce0fd108e4b82d120a93ad2caffffffffffffffff',
  },
  // RFC 3526 Section 5 — 4096-bit MODP Group
  modp16: {
    gen: '02',
    prime:
      'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
      '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
      'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
      'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
      'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
      'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
      '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
      '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
      'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
      'de2bcbf6955817183995497cea956ae515d2261898fa05101' +
      '5728e5a8aaac42dad33170d04507a33a85521abdf1cba64e' +
      'cfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7a' +
      'bf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf' +
      '12ffa06d98a0864d87602733ec86a64521f2b18177b200cb' +
      'be117577a615d6c770988c0bad946e208e24fa074e5ab314' +
      '3db5bfce0fd108e4b82d120a92108011a723c12a787e6d78' +
      '8719a10bdba5b2699c327186af4e23c1a946834b6150bda2' +
      '583e9ca2ad44ce8dbbbc2db04de8ef92e8efc141fbecaa62' +
      '87c59474e6bc05d99b2964fa090c3a2233ba186515be7ed1' +
      'f612970cee2d7afb81bdd762170481cd0069127d5b05aa99' +
      '3b4ea988d8fddc186ffb7dc90a6c08f4df435c934063199' +
      'ffffffffffffffff',
  },
  // RFC 3526 Section 6 — 6144-bit MODP Group
  modp17: {
    gen: '02',
    prime:
      'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
      '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
      'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
      'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
      'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
      'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
      '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
      '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
      'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
      'de2bcbf6955817183995497cea956ae515d2261898fa05101' +
      '5728e5a8aaac42dad33170d04507a33a85521abdf1cba64e' +
      'cfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7a' +
      'bf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf' +
      '12ffa06d98a0864d87602733ec86a64521f2b18177b200cb' +
      'be117577a615d6c770988c0bad946e208e24fa074e5ab314' +
      '3db5bfce0fd108e4b82d120a92108011a723c12a787e6d78' +
      '8719a10bdba5b2699c327186af4e23c1a946834b6150bda2' +
      '583e9ca2ad44ce8dbbbc2db04de8ef92e8efc141fbecaa62' +
      '87c59474e6bc05d99b2964fa090c3a2233ba186515be7ed1' +
      'f612970cee2d7afb81bdd762170481cd0069127d5b05aa99' +
      '3b4ea988d8fddc186ffb7dc90a6c08f4df435c93402849236c3fab4d27c7026c1d4dcb2602646dec9751e763dba37bdf8ff9406ad9e530ee5db382f413001aeb06a53ed9027d831179727b0865a8918da3edbebcf9b14ed44ce6cbaced4bb1bdb7f1447e6cc254b332051512bd7af426fb8f401378cd2bf5983ca01c64b92ecf032ea15d1721d03f482d7ce6e74fef6d55e702f46980c82b5a84031900b1c9e59e7c97fbec7e8f323a97a7e36cc88be0f1d45b7ff585ac54bd407b22b4154aacc8f6d7ebf48e1d814cc5ed20f8037e0a79715eef29be32806a1d58bb7c5da76f550aa3d8a1fbff0eb19ccb1a313d55cda56c9ec2ef29632387fe8d76e3c0468043e8f663f4860ee12bf2d5b0b7474d6e694f91e6dcc4024ffffffffffffffff',
  },
  // RFC 3526 Section 7 — 8192-bit MODP Group
  modp18: {
    gen: '02',
    prime:
      'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
      '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
      'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
      'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
      'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
      'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
      '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
      '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
      'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
      'de2bcbf6955817183995497cea956ae515d2261898fa05101' +
      '5728e5a8aaac42dad33170d04507a33a85521abdf1cba64e' +
      'cfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7a' +
      'bf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf' +
      '12ffa06d98a0864d87602733ec86a64521f2b18177b200cb' +
      'be117577a615d6c770988c0bad946e208e24fa074e5ab314' +
      '3db5bfce0fd108e4b82d120a92108011a723c12a787e6d78' +
      '8719a10bdba5b2699c327186af4e23c1a946834b6150bda2' +
      '583e9ca2ad44ce8dbbbc2db04de8ef92e8efc141fbecaa62' +
      '87c59474e6bc05d99b2964fa090c3a2233ba186515be7ed1' +
      'f612970cee2d7afb81bdd762170481cd0069127d5b05aa99' +
      '3b4ea988d8fddc186ffb7dc90a6c08f4df435c93402849236c3fab4d27c7026c1d4dcb2602646dec9751e763dba37bdf8ff9406ad9e530ee5db382f413001aeb06a53ed9027d831179727b0865a8918da3edbebcf9b14ed44ce6cbaced4bb1bdb7f1447e6cc254b332051512bd7af426fb8f401378cd2bf5983ca01c64b92ecf032ea15d1721d03f482d7ce6e74fef6d55e702f46980c82b5a84031900b1c9e59e7c97fbec7e8f323a97a7e36cc88be0f1d45b7ff585ac54bd407b22b4154aacc8f6d7ebf48e1d814cc5ed20f8037e0a79715eef29be32806a1d58bb7c5da76f550aa3d8a1fbff0eb19ccb1a313d55cda56c9ec2ef29632387fe8d76e3c0468043e8f663f4860ee12bf2d5b0b7474d6e694f91e6dbe115974a3926f12fee5e438777cb6a932df8cd8bec4d073b931ba3bc832b68d9dd300741fa7bf8afc47ed2576f6936ba424663aab639c5ae4f5683423b4742bf1c978238f16cbe39d652de3fdb8befc848ad922222e04a4037c0713eb57a81a23f0c73473fc646cea306b4bcbc8862f8385ddfa9d4b7fa2c087e879683303ed5bdd3a062b3cf5b3a278a66d2a13f83f44f82ddf310ee074ab6a364597e899a0255dc164f31cc50846851df9ab48195ded7ea1b1d510bd7ee74d73faf36bc31ecfa268359046f4eb879f924009438b481c6cd7889a002ed5ee382bc9190da6fc026e479558e4475677e9aa9e3050e2765694dfc81f56e880b96e7160c980dd98edd3dfffffffffffffffff',
  },
};

// ---------------------------------------------------------------------------
// BigInt utility helpers
// ---------------------------------------------------------------------------

/** Convert a hex string to BigInt. */
function hexToBigInt(hex: string): bigint {
  if (hex.length === 0) return 0n;
  return BigInt('0x' + hex);
}

/** Convert a BigInt to a Buffer (big-endian, unsigned). */
function bigIntToBuffer(n: bigint): Buffer {
  if (n === 0n) return Buffer.from([0]);

  let hex = n.toString(16);
  // Ensure even number of hex characters
  if (hex.length % 2 !== 0) {
    hex = '0' + hex;
  }
  return Buffer.from(hex, 'hex');
}

/** Convert a Buffer (big-endian, unsigned) to BigInt. */
function bufferToBigInt(buf: Buffer | Uint8Array): bigint {
  if (buf.length === 0) return 0n;
  const hex = Buffer.from(buf).toString('hex');
  if (hex.length === 0) return 0n;
  return BigInt('0x' + hex);
}

/**
 * Modular exponentiation: base^exp mod modulus
 * Uses the square-and-multiply algorithm with BigInt.
 */
function modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  if (exp === 0n) return 1n;

  let result = 1n;
  base = ((base % modulus) + modulus) % modulus;

  while (exp > 0n) {
    if (exp & 1n) {
      result = (result * base) % modulus;
    }
    exp >>= 1n;
    base = (base * base) % modulus;
  }

  return result;
}

/**
 * Count the bit length of a BigInt.
 */
function bitLength(n: bigint): number {
  if (n === 0n) return 0;
  return n.toString(2).length;
}

// ---------------------------------------------------------------------------
// Primality testing (for verifyError)
// ---------------------------------------------------------------------------

// Small primes for sieve test
const SMALL_PRIMES: number[] = [];
{
  // Generate primes up to ~1000 for the sieve
  const limit = 1000;
  const sieve = new Uint8Array(limit + 1);
  for (let i = 2; i * i <= limit; i++) {
    if (!sieve[i]) {
      for (let j = i * i; j <= limit; j += i) {
        sieve[j] = 1;
      }
    }
  }
  for (let i = 2; i <= limit; i++) {
    if (!sieve[i]) SMALL_PRIMES.push(i);
  }
}

/**
 * Simple sieve: check if n is divisible by any small prime.
 * Returns true if n passes the sieve (might be prime), false if composite.
 */
function simpleSieve(n: bigint): boolean {
  for (const p of SMALL_PRIMES) {
    const bp = BigInt(p);
    if (n % bp === 0n) {
      return n === bp;
    }
  }
  return true;
}

/**
 * Fermat primality test: 2^(n-1) mod n === 1
 */
function fermatTest(n: bigint): boolean {
  return modPow(2n, n - 1n, n) === 1n;
}

/**
 * Miller-Rabin primality test with a few fixed witnesses.
 * Returns true if n is probably prime, false if definitely composite.
 */
function millerRabinTest(n: bigint): boolean {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;

  // Write n - 1 as 2^r * d
  let d = n - 1n;
  let r = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    r++;
  }

  // Test with a few witnesses
  const witnesses = [2n, 3n, 5n, 7n, 11n, 13n];
  for (const a of witnesses) {
    if (a >= n) continue;

    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;

    let composite = true;
    for (let i = 0; i < r - 1; i++) {
      x = modPow(x, 2n, n);
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }

    if (composite) return false;
  }

  return true;
}

// DH_CHECK error flags (from OpenSSL / Node.js)
const DH_CHECK_P_NOT_PRIME = 0x01;
const DH_CHECK_P_NOT_SAFE_PRIME = 0x02;
const DH_NOT_SUITABLE_GENERATOR = 0x08;
const DH_UNABLE_TO_CHECK_GENERATOR = 0x04;

/**
 * Check the prime and generator for errors, matching OpenSSL/Node.js behavior.
 * Returns a bitmask of DH_CHECK_* flags.
 */
function checkPrime(prime: bigint, generatorBuf: Buffer): number {
  const genHex = generatorBuf.toString('hex');

  let error = 0;

  // Check if prime is even or fails primality tests
  if (prime % 2n === 0n || !simpleSieve(prime) || !fermatTest(prime) || !millerRabinTest(prime)) {
    // Not a prime: +1
    error += DH_CHECK_P_NOT_PRIME;

    if (genHex === '02' || genHex === '05') {
      // We'd be able to check the generator, it would fail: +8
      error += DH_NOT_SUITABLE_GENERATOR;
    } else {
      // We can't test the generator: +4
      error += DH_UNABLE_TO_CHECK_GENERATOR;
    }
    return error;
  }

  // Check if (prime - 1) / 2 is also prime (safe prime test)
  const halfPrime = prime >> 1n;
  if (!millerRabinTest(halfPrime)) {
    // Not a safe prime: +2
    error += DH_CHECK_P_NOT_SAFE_PRIME;
  }

  // Check generator suitability
  switch (genHex) {
    case '02':
      // For generator 2, prime mod 24 must equal 11
      if (prime % 24n !== 11n) {
        error += DH_NOT_SUITABLE_GENERATOR;
      }
      break;
    case '05':
      // For generator 5, prime mod 10 must equal 3 or 7
      {
        const rem = prime % 10n;
        if (rem !== 3n && rem !== 7n) {
          error += DH_NOT_SUITABLE_GENERATOR;
        }
      }
      break;
    default:
      // Can't test this generator: +4
      error += DH_UNABLE_TO_CHECK_GENERATOR;
  }

  return error;
}

// Cache for prime checks
const primeCheckCache: Record<string, number> = {};

function getCachedCheckPrime(prime: bigint, generatorBuf: Buffer): number {
  const key = generatorBuf.toString('hex') + '_' + prime.toString(16);
  if (key in primeCheckCache) {
    return primeCheckCache[key];
  }
  const result = checkPrime(prime, generatorBuf);
  primeCheckCache[key] = result;
  return result;
}

// ---------------------------------------------------------------------------
// DiffieHellman class
// ---------------------------------------------------------------------------

/**
 * Parse an input value to a Buffer, handling encoding parameters.
 */
function toBuffer(
  value: string | Buffer | Uint8Array | ArrayBuffer | number,
  encoding?: BufferEncoding,
): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, encoding || 'utf8');
  if (typeof value === 'number') {
    // Single byte number — treat as generator value
    const buf = Buffer.alloc(1);
    buf[0] = value;
    return buf;
  }
  throw new TypeError('Invalid input type');
}

/**
 * Format a BigInt return value as Buffer or encoded string.
 */
function formatReturnValue(n: bigint, encoding?: BufferEncoding): Buffer | string {
  const buf = bigIntToBuffer(n);
  if (!encoding) {
    return buf;
  }
  return buf.toString(encoding);
}

export class DiffieHellman {
  private _prime: bigint;
  private _generator: bigint;
  private _generatorBuf: Buffer;
  private _primeByteLength: number;
  private _pubKey: bigint | undefined;
  private _privKey: bigint | undefined;
  private _primeCode: number | undefined;
  private _malleable: boolean;

  constructor(prime: Buffer, generator: Buffer, malleable: boolean = false) {
    this._prime = bufferToBigInt(prime);
    this._generatorBuf = generator;
    this._generator = bufferToBigInt(generator);
    this._primeByteLength = prime.length;
    this._pubKey = undefined;
    this._privKey = undefined;
    this._primeCode = undefined;
    this._malleable = malleable;

    if (!malleable) {
      // For predefined groups (getDiffieHellman), verifyError is 0
      // and setPublicKey/setPrivateKey are not available (undefined),
      // matching Node.js behavior.
      this._primeCode = 0;
      // Remove setPublicKey/setPrivateKey from this instance so that
      // typeof dh.setPublicKey === 'undefined', matching Node.js.
      // Setting instance properties to undefined shadows the prototype methods.
      this.setPublicKey = undefined as unknown as DiffieHellman['setPublicKey'];
      this.setPrivateKey = undefined as unknown as DiffieHellman['setPrivateKey'];
    }
  }

  /**
   * Error code from prime/generator validation.
   * Lazily computed on first access.
   */
  get verifyError(): number {
    if (typeof this._primeCode !== 'number') {
      this._primeCode = getCachedCheckPrime(this._prime, this._generatorBuf);
    }
    return this._primeCode;
  }

  /**
   * Generate a random private key and compute the corresponding public key.
   * Returns the public key as a Buffer (or encoded string).
   */
  generateKeys(): Buffer;
  generateKeys(encoding: BufferEncoding): string;
  generateKeys(encoding?: BufferEncoding): Buffer | string {
    if (!this._privKey) {
      // Generate random bytes equal to the prime byte length
      const randBuf = randomBytes(this._primeByteLength);
      this._privKey = bufferToBigInt(randBuf);
    }

    // publicKey = generator ^ privateKey mod prime
    this._pubKey = modPow(this._generator, this._privKey, this._prime);

    return this.getPublicKey(encoding as BufferEncoding);
  }

  /**
   * Compute the shared secret using the other party's public key.
   */
  computeSecret(otherPublicKey: Buffer | Uint8Array | string, inputEncoding?: BufferEncoding): Buffer;
  computeSecret(otherPublicKey: Buffer | Uint8Array | string, inputEncoding: BufferEncoding, outputEncoding: BufferEncoding): string;
  computeSecret(
    otherPublicKey: Buffer | Uint8Array | string,
    inputEncoding?: BufferEncoding,
    outputEncoding?: BufferEncoding,
  ): Buffer | string {
    let otherBuf: Buffer;
    if (typeof otherPublicKey === 'string') {
      otherBuf = Buffer.from(otherPublicKey, inputEncoding || 'utf8');
    } else {
      otherBuf = Buffer.from(otherPublicKey);
    }

    const other = bufferToBigInt(otherBuf);

    if (!this._privKey) {
      throw new Error('You must generate keys before computing a secret');
    }

    if (other <= 0n || other >= this._prime) {
      throw new Error('Supplied key is too large');
    }

    // secret = otherPublicKey ^ privateKey mod prime
    const secret = modPow(other, this._privKey, this._prime);
    let out = bigIntToBuffer(secret);

    // Pad the output to the prime length (matching Node.js behavior)
    const primeLen = this._primeByteLength;
    if (out.length < primeLen) {
      const padded = Buffer.alloc(primeLen);
      out.copy(padded, primeLen - out.length);
      out = padded;
    }

    if (outputEncoding) {
      return out.toString(outputEncoding);
    }
    return out;
  }

  /**
   * Get the prime as a Buffer or encoded string.
   */
  getPrime(): Buffer;
  getPrime(encoding: BufferEncoding): string;
  getPrime(encoding?: BufferEncoding): Buffer | string {
    return formatReturnValue(this._prime, encoding as BufferEncoding);
  }

  /**
   * Get the generator as a Buffer or encoded string.
   */
  getGenerator(): Buffer;
  getGenerator(encoding: BufferEncoding): string;
  getGenerator(encoding?: BufferEncoding): Buffer | string {
    return formatReturnValue(this._generator, encoding as BufferEncoding);
  }

  /**
   * Get the public key as a Buffer or encoded string.
   */
  getPublicKey(): Buffer;
  getPublicKey(encoding: BufferEncoding): string;
  getPublicKey(encoding?: BufferEncoding): Buffer | string {
    if (!this._pubKey) {
      throw new Error('No public key - call generateKeys() first');
    }
    return formatReturnValue(this._pubKey, encoding as BufferEncoding);
  }

  /**
   * Get the private key as a Buffer or encoded string.
   */
  getPrivateKey(): Buffer;
  getPrivateKey(encoding: BufferEncoding): string;
  getPrivateKey(encoding?: BufferEncoding): Buffer | string {
    if (!this._privKey) {
      throw new Error('No private key - call generateKeys() first');
    }
    return formatReturnValue(this._privKey, encoding as BufferEncoding);
  }

  /**
   * Set the public key. Only available for malleable DH instances
   * (created via createDiffieHellman, not getDiffieHellman).
   */
  setPublicKey(publicKey: Buffer | Uint8Array | string, encoding?: BufferEncoding): void {
    if (!this._malleable) {
      throw new Error('setPublicKey is not available for predefined DH groups');
    }
    const buf = typeof publicKey === 'string'
      ? Buffer.from(publicKey, encoding || 'utf8')
      : Buffer.from(publicKey);
    this._pubKey = bufferToBigInt(buf);
  }

  /**
   * Set the private key. Only available for malleable DH instances
   * (created via createDiffieHellman, not getDiffieHellman).
   */
  setPrivateKey(privateKey: Buffer | Uint8Array | string, encoding?: BufferEncoding): void {
    if (!this._malleable) {
      throw new Error('setPrivateKey is not available for predefined DH groups');
    }
    const buf = typeof privateKey === 'string'
      ? Buffer.from(privateKey, encoding || 'utf8')
      : Buffer.from(privateKey);
    this._privKey = bufferToBigInt(buf);
  }
}

// ---------------------------------------------------------------------------
// Prime generation for createDiffieHellman(primeLength)
// ---------------------------------------------------------------------------

/**
 * Generate a random prime of the specified bit length suitable for DH.
 * This matches OpenSSL's behavior: for generators 2 and 5 the prime
 * must satisfy specific congruence conditions.
 */
function generatePrime(bits: number, generator: Buffer): Buffer {
  const gen = bufferToBigInt(generator);

  if (bits < 16) {
    // Match OpenSSL behavior for very small bit counts
    if (gen === 2n || gen === 5n) {
      return Buffer.from([0x8c, 0x7b]);
    } else {
      return Buffer.from([0x8c, 0x27]);
    }
  }

  const byteLen = Math.ceil(bits / 8);
  const ONE = 1n;
  const TWO = 2n;
  const FOUR = 4n;
  const TWENTYFOUR = 24n;
  const ELEVEN = 11n;
  const TEN = 10n;
  const THREE = 3n;

  while (true) {
    const randBuf = randomBytes(byteLen);
    let num = bufferToBigInt(randBuf);

    // Trim to desired bit length
    while (bitLength(num) > bits) {
      num >>= 1n;
    }

    // Make odd
    if (num % TWO === 0n) {
      num += ONE;
    }

    // Ensure bit 1 is set (num must be 3 mod 4 for safe primes)
    if (!(num & TWO)) {
      num += TWO;
    }

    // Adjust for generator congruence requirements
    if (gen === TWO) {
      // For generator 2: prime mod 24 must equal 11
      while (num % TWENTYFOUR !== ELEVEN) {
        num += FOUR;
      }
    } else if (gen === 5n) {
      // For generator 5: prime mod 10 must equal 3
      while (num % TEN !== THREE) {
        num += FOUR;
      }
    }

    // Check that (num - 1) / 2 is also prime (safe prime)
    const n2 = num >> 1n;

    if (
      simpleSieve(n2) && simpleSieve(num) &&
      fermatTest(n2) && fermatTest(num) &&
      millerRabinTest(n2) && millerRabinTest(num)
    ) {
      return bigIntToBuffer(num);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const VALID_ENCODINGS: Record<string, boolean> = {
  binary: true,
  hex: true,
  base64: true,
  latin1: true,
  utf8: true,
  'utf-8': true,
  base64url: true,
  ascii: true,
  ucs2: true,
  'ucs-2': true,
  utf16le: true,
  'utf-16le': true,
};

/**
 * Create a DiffieHellman key exchange object.
 *
 * Usage:
 *   createDiffieHellman(primeLength)
 *   createDiffieHellman(primeLength, generator)
 *   createDiffieHellman(prime, primeEncoding, generator, generatorEncoding)
 *   createDiffieHellman(prime, generator)
 */
export function createDiffieHellman(
  prime: number | string | Buffer | Uint8Array,
  primeEncoding?: BufferEncoding | number | string | Buffer | Uint8Array,
  generator?: number | string | Buffer | Uint8Array,
  generatorEncoding?: BufferEncoding,
): DiffieHellman {
  // If primeEncoding is a Buffer or not a valid encoding string, treat it as
  // the generator argument (shift arguments right)
  if (
    primeEncoding !== undefined &&
    typeof primeEncoding !== 'number' &&
    (Buffer.isBuffer(primeEncoding) ||
      primeEncoding instanceof Uint8Array ||
      (typeof primeEncoding === 'string' && !(primeEncoding in VALID_ENCODINGS)))
  ) {
    return createDiffieHellman(
      prime,
      'binary' as BufferEncoding,
      primeEncoding as unknown as string | Buffer | Uint8Array,
      generator as unknown as BufferEncoding,
    );
  }

  const enc = (primeEncoding as BufferEncoding) || ('binary' as BufferEncoding);
  const genc = generatorEncoding || ('binary' as BufferEncoding);
  let genBuf: Buffer = Buffer.from([2]);

  if (generator !== undefined) {
    if (typeof generator === 'number') {
      genBuf = Buffer.alloc(1);
      genBuf[0] = generator;
    } else if (!Buffer.isBuffer(generator)) {
      genBuf = Buffer.from(generator as string, genc);
    } else {
      genBuf = generator;
    }
  }

  // If prime is a number, generate a random prime of that bit length
  if (typeof prime === 'number') {
    const primeBuf = generatePrime(prime, genBuf);
    return new DiffieHellman(primeBuf, genBuf, true);
  }

  // Otherwise parse the prime
  let primeBuf: Buffer;
  if (Buffer.isBuffer(prime)) {
    primeBuf = prime;
  } else if (prime instanceof Uint8Array) {
    primeBuf = Buffer.from(prime);
  } else {
    primeBuf = Buffer.from(prime, enc);
  }

  return new DiffieHellman(primeBuf, genBuf, true);
}

/**
 * Create a DiffieHellman key exchange object using a predefined MODP group.
 *
 * Note: Instances from getDiffieHellman do NOT have setPublicKey/setPrivateKey,
 * matching Node.js behavior where predefined group instances are not malleable.
 */
export function getDiffieHellman(groupName: string): DiffieHellman {
  const group = PREDEFINED_GROUPS[groupName];
  if (!group) {
    throw new Error(`Unknown group: ${groupName}. Supported groups: ${Object.keys(PREDEFINED_GROUPS).join(', ')}`);
  }
  const primeBuf = Buffer.from(group.prime, 'hex');
  const genBuf = Buffer.from(group.gen, 'hex');
  return new DiffieHellman(primeBuf, genBuf, false);
}

/** Alias for getDiffieHellman. */
export const createDiffieHellmanGroup = getDiffieHellman;

/** Alias for getDiffieHellman. */
export const DiffieHellmanGroup = getDiffieHellman;
