import type GObject from '@girs/gobject-2.0';

/**
 * Custom signals registered through `registerClass` are not in the generated `SignalSignatures`
 * of the base class, so `emit`/`connect` reject them at compile time; these two name the gap once.
 */
export function emitSignal(object: GObject.Object, name: string, ...args: unknown[]): void {
    (object as unknown as { emit(name: string, ...args: unknown[]): void }).emit(name, ...args);
}

export function onSignal(object: GObject.Object, name: string, callback: (...args: never[]) => void): number {
    return (object as unknown as { connect(name: string, cb: (...args: never[]) => void): number }).connect(
        name,
        callback,
    );
}
