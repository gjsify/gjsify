// NativeScript platform detection.
//
// NativeScript injects Java classes (`java.*`, `android.*`) as globals on
// Android and Objective-C classes (`NSFileManager`, `UIDevice`, …) on iOS.
// None of them exist on GJS, Node.js, or browser runtimes — so the booleans
// below double as a portable "am I running under NativeScript?" check.
//
// The runtime-presence signals (`java` / `NSFileManager`) intentionally match
// what @gjsify/native-fs-bridge keys on, so consumers that import `isAndroid` /
// `isIOS` from here get exactly the value the bridge would have computed.

// ===== Platform globals (typed, no `any`) =====

declare const java: unknown | undefined;
declare const NSFileManager: unknown | undefined;

// `android.os.Build` carries the Android version / SDK / device metadata.
declare const android:
    | {
          os: {
              Build: {
                  MODEL: string;
                  MANUFACTURER: string;
                  VERSION: { SDK_INT: number; RELEASE: string };
              };
          };
      }
    | undefined;

// `UIDevice.currentDevice` carries the iOS version / model metadata.
declare const UIDevice:
    | {
          currentDevice: {
              systemVersion: string;
              model: string;
              systemName: string;
          };
      }
    | undefined;

// ===== Detection =====

/** True when running under NativeScript on Android (the Java bridge is present). */
export const isAndroid: boolean = typeof java !== 'undefined';

/** True when running under NativeScript on iOS (the Foundation bridge is present). */
export const isIOS: boolean = typeof NSFileManager !== 'undefined';

/** True when running under NativeScript on any platform. */
export const isNativeScript: boolean = isAndroid || isIOS;

export type PlatformName = 'android' | 'ios' | 'unknown';

/** The current platform, or `'unknown'` outside NativeScript. */
export function platformName(): PlatformName {
    if (isAndroid) return 'android';
    if (isIOS) return 'ios';
    return 'unknown';
}

/**
 * Throw if not running under NativeScript. Use this to guard code paths that
 * genuinely require a native bridge (the info getters below stay non-throwing).
 */
export function assertNativeScript(): void {
    if (!isNativeScript) {
        throw new Error('Platform not supported');
    }
}

// ===== Device / OS info =====

export interface PlatformInfo {
    /** `'android'`, `'ios'`, or `'unknown'`. */
    platform: PlatformName;
    /** OS release string — e.g. Android `"13"` or iOS `"17.0"`; `'unknown'` otherwise. */
    osVersion: string;
    /** Android API level (e.g. `33`); `null` on iOS or off-platform. */
    sdkInt: number | null;
    /** Device model — e.g. `"Pixel 7"` / `"iPhone"`; `'unknown'` if unavailable. */
    deviceModel: string;
    /** Device manufacturer — Android `Build.MANUFACTURER`, iOS `"Apple"`; `'unknown'` otherwise. */
    manufacturer: string;
}

const UNKNOWN_INFO: PlatformInfo = {
    platform: 'unknown',
    osVersion: 'unknown',
    sdkInt: null,
    deviceModel: 'unknown',
    manufacturer: 'unknown',
};

function androidInfo(): PlatformInfo {
    // `android` is injected alongside `java`, but guard defensively so a missing
    // global degrades to `'unknown'` rather than throwing.
    const build = (android as NonNullable<typeof android>)?.os?.Build;
    if (!build) return { ...UNKNOWN_INFO, platform: 'android' };
    return {
        platform: 'android',
        osVersion: build.VERSION?.RELEASE ?? 'unknown',
        sdkInt: typeof build.VERSION?.SDK_INT === 'number' ? build.VERSION.SDK_INT : null,
        deviceModel: build.MODEL ?? 'unknown',
        manufacturer: build.MANUFACTURER ?? 'unknown',
    };
}

function iosInfo(): PlatformInfo {
    const device = (UIDevice as NonNullable<typeof UIDevice>)?.currentDevice;
    if (!device) return { ...UNKNOWN_INFO, platform: 'ios', manufacturer: 'Apple' };
    return {
        platform: 'ios',
        osVersion: device.systemVersion ?? 'unknown',
        sdkInt: null,
        deviceModel: device.model ?? 'unknown',
        manufacturer: 'Apple',
    };
}

/**
 * Platform, OS version, SDK level, device model and manufacturer.
 * Non-throwing: returns an all-`'unknown'` record outside NativeScript so
 * callers can read it unconditionally and branch on `platform`.
 */
export function platformInfo(): PlatformInfo {
    if (isAndroid) return androidInfo();
    if (isIOS) return iosInfo();
    return { ...UNKNOWN_INFO };
}

/** OS release string — convenience accessor over {@link platformInfo}. */
export function osVersion(): string {
    return platformInfo().osVersion;
}

/** Android API level, or `null` on iOS / off-platform. */
export function sdkInt(): number | null {
    return platformInfo().sdkInt;
}

/** Device model, or `'unknown'` if unavailable. */
export function deviceModel(): string {
    return platformInfo().deviceModel;
}
