// @gjsify/devtools-protocol — generic method surface + pause classification.
// Original implementation.

/**
 * How a method behaves while external control is paused by the host:
 * - `read-only` — observation/diagnostics; always allowed.
 * - `presence`  — an external driver's own awareness channel (cursor/label); allowed.
 * - `mutating`  — edits app state or the user's UI; rejected while paused.
 */
export type MethodKind = 'read-only' | 'presence' | 'mutating';

/**
 * The generic, toolkit-neutral devtools methods and their kinds. Adapters
 * (DBus / WebSocket) implement the subset they support; the bridge
 * advertises only the implemented ones. App-specific methods are added via
 * extensions with their own kinds — the registry rejects an unclassified
 * method name, so a new method cannot bypass the pause policy unnoticed.
 */
export const GENERIC_METHODS = {
    // --- Phase 1 (core control plane) ---
    GetStatus: 'read-only',
    Screenshot: 'read-only',
    ListActions: 'read-only',
    ActivateAction: 'mutating',
    ChangeActionState: 'mutating',
    PresentWindow: 'read-only',
    ResizeWindow: 'mutating',
    // --- Phase 3 (full introspection) ---
    ListToplevels: 'read-only',
    DumpTree: 'read-only',
    GetProperty: 'read-only',
    SetProperty: 'mutating',
    GetFocused: 'read-only',
    EmitSignal: 'mutating',
    DumpGSettings: 'read-only',
    DumpCss: 'read-only',
    SwapCss: 'mutating',
} as const satisfies Record<string, MethodKind>;

export type GenericMethodName = keyof typeof GENERIC_METHODS;
