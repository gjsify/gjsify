import { BufferSource } from "stream/web";

export const op_sign_ed25519 = (keyData, data: BufferSource, signature: Uint8Array) => {
    console.warn("Not implemented: ops.op_sign_ed25519");
    return false;
}

export const op_verify_ed25519 = (keyData, data: BufferSource, signature: BufferSource) => {
    console.warn("Not implemented: ops.op_verify_ed25519");
    return false;
}

export const op_crypto_get_random_values = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_get_random_values");
}
export const op_crypto_generate_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_generate_key");
}
export const op_crypto_sign_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_sign_key");
}
export const op_crypto_verify_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_verify_key");
}
export const op_crypto_derive_bits = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_derive_bits");
}
export const op_crypto_import_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_import_key");
    const rawData = {
        data: new ArrayBuffer(0),
    }
    const modulusLength = 0;
    const publicExponent = undefined;
    return { modulusLength, publicExponent, rawData }
}
export const op_crypto_export_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_export_key");
    const data = { k: "", buffer: new ArrayBuffer(0) }
    return data;
}
export const op_crypto_encrypt = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_encrypt");
}
export const op_crypto_decrypt = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_decrypt");
}
export const op_crypto_subtle_digest = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_subtle_digest");
}
export const op_crypto_random_uuid = (): string => {
    console.warn("Not implemented: ops.op_crypto_random_uuid");
    return "";
}
export const op_crypto_wrap_key = async (data: { key, algorithm: string}, unwrappedKey: Uint8Array) => {
    console.warn("Not implemented: ops.op_crypto_wrap_key");
    const buffer = new ArrayBuffer(0);
    return { buffer }
}
export const op_crypto_unwrap_key = (data: { key, algorithm: string}, wrappedKey: BufferSource) => {
    console.warn("Not implemented: ops.op_crypto_unwrap_key");
    const buffer = new ArrayBuffer(0);
    return { buffer }
}

export const op_generate_x25519_keypair = (privateKeyData: Uint8Array, publicKeyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_generate_x25519_keypair");
    return false;
}

export const op_generate_ed25519_keypair = (privateKeyData: Uint8Array, publicKeyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_generate_ed25519_keypair");
    return false;
}

export const op_import_spki_ed25519 = (privateKeyData: Uint8Array, publicKeyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_import_spki_ed25519");
    return false;
}

export const op_import_pkcs8_ed25519 = (privateKeyData: Uint8Array, publicKeyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_import_pkcs8_ed25519");
    return false;
}

export const op_crypto_base64url_decode = (encoded: string) => {
    console.warn("Not implemented: ops.op_crypto_base64url_decode");
    return false;
}

export const op_crypto_base64url_encode = (decoded) => {
    console.warn("Not implemented: ops.op_crypto_base64url_encode");
    return "";
}

export const op_import_spki_x25519 = (privateKeyData: Uint8Array, publicKeyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_import_spki_x25519");
    return false;
}

export const op_import_pkcs8_x25519 = (privateKeyData: Uint8Array, publicKeyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_import_pkcs8_x25519");
    return false;
}

export const op_export_spki_ed25519 = (keyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_export_spki_ed25519");
    const buffer = new ArrayBuffer(0);
    return { buffer };
}

export const op_export_pkcs8_ed25519 = (keyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_export_pkcs8_ed25519");
    const buffer = new ArrayBuffer(0);
    return { buffer };
}

export const op_jwk_x_ed25519 = (keyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_jwk_x_ed25519");
    return ""
}

export const op_export_spki_x25519 = (keyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_export_spki_x25519");
    const buffer = new ArrayBuffer(0);
    return { buffer };
}

export const op_export_pkcs8_x25519 = (keyData: Uint8Array) => {
    console.warn("Not implemented: ops.op_export_pkcs8_x25519");
    const buffer = new ArrayBuffer(0);
    return { buffer };
}

export const op_derive_bits_x25519 = (keyData: Uint8Array, publicKeyData: Uint8Array, secret) => {
    console.warn("Not implemented: ops.op_derive_bits_x25519");
    const buffer = new ArrayBuffer(0);
    return { buffer };
}
