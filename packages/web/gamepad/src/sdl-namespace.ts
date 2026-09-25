// The part of `gi://GjsifyGamepad` (the `@gjsify/gamepad-native` shim, ADR 0075) this
// package uses, as types. Hand-written rather than generated: no `@girs/*` package binds
// the shim's namespace, and the subset is small. It is also exactly the surface a test
// fake has to provide, which keeps the fakes honest about what the source calls.

/** One controller: `GjsifyGamepad.Device`. */
export interface GjsifyGamepadDevice {
    get_name(): string;
    /** SDL's 32-hex-digit GUID; carries the USB vendor and product. */
    get_guid(): string;
    /** W3C standard buttons 0–16, 0..1 (the triggers 6/7 analog, the rest 0 or 1). */
    get_buttons(): number[];
    /** W3C standard axes 0–3, -1..1. */
    get_axes(): number[];
    has_rumble(): boolean;
    has_trigger_rumble(): boolean;
    rumble(lowFrequency: number, highFrequency: number, durationMs: number): boolean;
    rumble_triggers(left: number, right: number, durationMs: number): boolean;
}

/** `GjsifyGamepad.Monitor` — the subset the source uses. */
export interface GjsifyGamepadMonitor {
    update(): void;
    close(): void;
    connect(
        signal: 'device-added' | 'device-removed',
        callback: (monitor: GjsifyGamepadMonitor, device: GjsifyGamepadDevice) => void,
    ): number;
    disconnect(id: number): void;
}

/** The `gi://GjsifyGamepad` namespace — the subset the source uses. */
export interface GjsifyGamepadNamespace {
    /** A GI class: the probe checks `typeof Monitor === 'function'`. */
    Monitor: { new: () => GjsifyGamepadMonitor };
}
