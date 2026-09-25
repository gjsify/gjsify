// ALPHA / LUMINANCE / LUMINANCE_ALPHA on a desktop-GL CORE profile.
//
// WebGL 1 and 2 both keep the three legacy unsized formats (GLES 2.0 and 3.0
// define them), but the desktop core profile REMOVED them: on a core context
// `glTexImage2D(..., GL_LUMINANCE, ...)` is `GL_INVALID_ENUM` and nothing is
// stored. macOS only ever hands out a core profile (CGL has no GLES and no
// compatibility profile above 2.1), and win32's Mesa context through GDK is core
// too, so there a WebGL consumer uploading a font atlas as ALPHA or a video
// plane as LUMINANCE got an error and a black texture.
//
// The emulation is the one ANGLE and every browser on a core backend use: store
// the channels in a one- or two-channel RED/RG texture and let the texture
// SWIZZLE reproduce what the legacy format samples as:
//
//   ALPHA            → R8,  sampled (0, 0, 0, R)
//   LUMINANCE        → R8,  sampled (R, R, R, 1)
//   LUMINANCE_ALPHA  → RG8, sampled (R, R, R, G)
//
// The pixel data needs no conversion: an ALPHA/LUMINANCE row is one byte (or
// float) per texel and a LUMINANCE_ALPHA row two, exactly the RED/RG layout.
//
// Pure data here (numeric GL enums, no context), so the mapping is checked by
// `legacy-formats.spec.ts` on every host — including the ones whose GL context
// never needs it.

const ALPHA = 0x1906;
const LUMINANCE = 0x1909;
const LUMINANCE_ALPHA = 0x190a;

const RED = 0x1903;
const GREEN = 0x1904;
const BLUE = 0x1905;
const RG = 0x8227;
const ZERO = 0;
const ONE = 1;

const UNSIGNED_BYTE = 0x1401;
const FLOAT = 0x1406;
const HALF_FLOAT = 0x140b;
const HALF_FLOAT_OES = 0x8d61;

const R8 = 0x8229;
const RG8 = 0x822b;
const R16F = 0x822d;
const RG16F = 0x822f;
const R32F = 0x822e;
const RG32F = 0x8230;

const TEXTURE_CUBE_MAP = 0x8513;
const TEXTURE_CUBE_MAP_POSITIVE_X = 0x8515;
const TEXTURE_CUBE_MAP_NEGATIVE_Z = 0x851a;

/** `GL_TEXTURE_SWIZZLE_R/G/B/A` — core since GL 3.3, which every core profile the emulation runs on exceeds. */
export const TEXTURE_SWIZZLE_PNAMES = [0x8e42, 0x8e43, 0x8e44, 0x8e45] as const;

export type Swizzle = readonly [number, number, number, number];

/** What a texture samples as when nothing is emulated. */
export const IDENTITY_SWIZZLE: Swizzle = [RED, GREEN, BLUE, ALPHA];

/** How a legacy-format image is stored on a core profile. */
export interface LegacyFormatStorage {
    /** Sized internal format handed to the driver. */
    internalFormat: number;
    /** Pixel-transfer format handed to the driver (`RED` or `RG`). */
    format: number;
    /** Texture swizzle that makes the stored channels sample as the legacy format. */
    swizzle: Swizzle;
}

export function isLegacyFormat(format: number): boolean {
    return format === ALPHA || format === LUMINANCE || format === LUMINANCE_ALPHA;
}

/**
 * The core-profile storage for a legacy-format image of `type`, or `null` when
 * `format` is not a legacy format or `type` is one the legacy formats never
 * accept — the driver then sees the call unchanged and raises the error itself.
 *
 * The internal format is SIZED, never the unsized `RED`/`RG`: an unsized format
 * leaves the storage precision to a desktop driver, and a float LUMINANCE
 * upload (OES_texture_float) must not be quantised to 8 bits — the same
 * reasoning as `_nativeFloatInternalFormat` for RGBA.
 */
export function coreStorageForLegacyFormat(format: number, type: number): LegacyFormatStorage | null {
    if (!isLegacyFormat(format)) return null;
    const two = format === LUMINANCE_ALPHA;
    let internalFormat: number;
    switch (type) {
        case UNSIGNED_BYTE:
            internalFormat = two ? RG8 : R8;
            break;
        case FLOAT:
            internalFormat = two ? RG32F : R32F;
            break;
        case HALF_FLOAT:
        case HALF_FLOAT_OES:
            internalFormat = two ? RG16F : R16F;
            break;
        default:
            return null;
    }
    return { internalFormat, format: two ? RG : RED, swizzle: legacySwizzle(format) };
}

/** The swizzle a legacy format samples through once stored as RED/RG. */
export function legacySwizzle(format: number): Swizzle {
    if (format === ALPHA) return [ZERO, ZERO, ZERO, RED];
    if (format === LUMINANCE) return [RED, RED, RED, ONE];
    return [RED, RED, RED, GREEN];
}

/**
 * The pixel-transfer format a `texSubImage*` must hand the driver for a
 * legacy `format` on a core profile: the storage layout, not the legacy name.
 * Any other format is returned unchanged.
 */
export function coreTransferFormat(format: number): number {
    if (format === LUMINANCE_ALPHA) return RG;
    if (format === ALPHA || format === LUMINANCE) return RED;
    return format;
}

/**
 * The target `texParameter*` takes for an image `target`: a cube-map FACE
 * names an image, but the swizzle belongs to the cube-map texture as a whole.
 */
export function textureParameterTarget(target: number): number {
    return target >= TEXTURE_CUBE_MAP_POSITIVE_X && target <= TEXTURE_CUBE_MAP_NEGATIVE_Z ? TEXTURE_CUBE_MAP : target;
}

/**
 * Pick the legacy channels out of tightly packed RGBA8 pixels, in the RED/RG
 * layout the core storage holds: ALPHA keeps A, LUMINANCE keeps R (GLES defines
 * a copied luminance as the red component), LUMINANCE_ALPHA keeps R and A.
 * Used where the source is a framebuffer read back, not consumer data.
 */
export function extractLegacyChannels(rgba: Uint8Array, format: number): Uint8Array {
    const texels = rgba.length >> 2;
    if (format === LUMINANCE_ALPHA) {
        const out = new Uint8Array(texels * 2);
        for (let i = 0; i < texels; ++i) {
            out[2 * i] = rgba[4 * i];
            out[2 * i + 1] = rgba[4 * i + 3];
        }
        return out;
    }
    const channel = format === ALPHA ? 3 : 0;
    const out = new Uint8Array(texels);
    for (let i = 0; i < texels; ++i) out[i] = rgba[4 * i + channel];
    return out;
}
