// The Android backend: an AES-256-GCM key in the AndroidKeyStore and ciphertext files under
// Context.getNoBackupFilesDir() — ADR 0152. Everything that is a JS-vs-Java conversion lives
// here; what goes into the files is decided in driver.ts.
//
// Blob layout: [ivLength: 1 byte][iv][ciphertext ‖ 16-byte GCM tag]. The IV is chosen by the
// Keystore (KeyGenParameterSpec requires randomized encryption), a new one per write.

import { Utils } from '@nativescript/core';

import { fromSignedBytes, writeSignedBytes } from './bytes.js';
import type { RawBackend } from './driver.js';

// NativeScript's ambient host globals.
declare const java: any;
declare const javax: any;
declare const android: any;
declare const Array: ArrayConstructor & { create(type: string, length: number): any };

const KEY_ALIAS_PREFIX = 'gjsify.secret-store.v1.';
const DIRECTORY = 'gjsify-secrets';
const TAG_BITS = 128;
const ENCRYPT_MODE = 1; // javax.crypto.Cipher.ENCRYPT_MODE
const DECRYPT_MODE = 2; // javax.crypto.Cipher.DECRYPT_MODE

function toJavaBytes(data: Uint8Array): any {
    return writeSignedBytes(data, Array.create('byte', data.length));
}

function javaStrings(...values: string[]): any {
    const out = Array.create('java.lang.String', values.length);
    values.forEach((v, i) => (out[i] = v));
    return out;
}

export function createAndroidBackend(): RawBackend {
    let root: any = null;
    const keys = new Map<string, any>();

    const keyStore = (): any => {
        const ks = java.security.KeyStore.getInstance('AndroidKeyStore');
        ks.load(null);
        return ks;
    };

    const secretKey = (keyId: string): any => {
        const cached = keys.get(keyId);
        if (cached) return cached;
        const alias = KEY_ALIAS_PREFIX + keyId;
        const ks = keyStore();
        if (!ks.containsAlias(alias)) {
            const props = android.security.keystore.KeyProperties;
            const spec = new android.security.keystore.KeyGenParameterSpec.Builder(
                alias,
                props.PURPOSE_ENCRYPT | props.PURPOSE_DECRYPT,
            )
                .setBlockModes(javaStrings(props.BLOCK_MODE_GCM))
                .setEncryptionPaddings(javaStrings(props.ENCRYPTION_PADDING_NONE))
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build();
            const generator = javax.crypto.KeyGenerator.getInstance(props.KEY_ALGORITHM_AES, 'AndroidKeyStore');
            generator.init(spec);
            generator.generateKey();
        }
        const key = ks.getKey(alias, null);
        keys.set(keyId, key);
        return key;
    };

    // noBackupFilesDir, not filesDir: Auto Backup and device-to-device transfer skip it, and a
    // restored ciphertext whose Keystore key stayed on the old device could never be read.
    const directory = (): any => {
        if (root) return root;
        const context = Utils.android.getApplicationContext();
        root = new java.io.File(context.getNoBackupFilesDir(), DIRECTORY);
        if (!root.isDirectory() && !root.mkdirs() && !root.isDirectory()) {
            throw new Error('cannot create the secret directory');
        }
        return root;
    };

    return {
        encrypt(keyId, plain) {
            const cipher = javax.crypto.Cipher.getInstance('AES/GCM/NoPadding');
            cipher.init(ENCRYPT_MODE, secretKey(keyId));
            const iv = fromSignedBytes(cipher.getIV());
            const sealed = fromSignedBytes(cipher.doFinal(toJavaBytes(plain)));
            const out = new Uint8Array(1 + iv.length + sealed.length);
            out[0] = iv.length;
            out.set(iv, 1);
            out.set(sealed, 1 + iv.length);
            return out;
        },
        decrypt(keyId, blob) {
            const ivLength = blob[0];
            if (blob.length < 1 + ivLength + TAG_BITS / 8) throw new Error('truncated secret file');
            const iv = blob.subarray(1, 1 + ivLength);
            const sealed = blob.subarray(1 + ivLength);
            const cipher = javax.crypto.Cipher.getInstance('AES/GCM/NoPadding');
            cipher.init(
                DECRYPT_MODE,
                secretKey(keyId),
                new javax.crypto.spec.GCMParameterSpec(TAG_BITS, toJavaBytes(iv)),
            );
            return fromSignedBytes(cipher.doFinal(toJavaBytes(sealed)));
        },
        deleteKey(keyId) {
            keys.delete(keyId);
            const ks = keyStore();
            if (ks.containsAlias(KEY_ALIAS_PREFIX + keyId)) ks.deleteEntry(KEY_ALIAS_PREFIX + keyId);
        },
        readFile(name) {
            const file = new java.io.File(directory(), name);
            if (!file.isFile()) return null;
            const bytes = Array.create('byte', file.length());
            const stream = new java.io.FileInputStream(file);
            try {
                let read = 0;
                while (read < bytes.length) {
                    const n = stream.read(bytes, read, bytes.length - read);
                    if (n < 0) break;
                    read += n;
                }
            } finally {
                stream.close();
            }
            return fromSignedBytes(bytes);
        },
        writeFileAtomic(name, data) {
            const target = new java.io.File(directory(), name);
            const temp = new java.io.File(directory(), `${name}.tmp`);
            const stream = new java.io.FileOutputStream(temp);
            try {
                stream.write(toJavaBytes(data));
                stream.getFD().sync();
            } finally {
                stream.close();
            }
            // rename(2) within one directory replaces the target atomically.
            if (!temp.renameTo(target)) {
                temp.delete();
                throw new Error('rename failed');
            }
        },
        deleteFile(name) {
            const file = new java.io.File(directory(), name);
            if (file.exists() && !file.delete()) throw new Error('delete failed');
        },
    };
}
