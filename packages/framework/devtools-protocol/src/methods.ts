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
 *
 * A NAME HERE IS A PROMISE, so nothing may be listed ahead of an adapter.
 * `SetProperty` and `EmitSignal` were classified `mutating` here and existed on
 * no wire at all: no `<method>` fragment in `GENERIC_METHODS_XML`, no handler
 * in `DevtoolsService`, no MCP tool. A caller reading this contract saw the
 * name and the kind, called it, and got `UnknownMethod` — the classification
 * made a method look supported and the pause policy look complete. Both were
 * removed rather than stubbed; add each back in the change that lands its
 * adapter, which is the only change that can prove the kind is right.
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
    GetFocused: 'read-only',
    ActivateWidget: 'mutating',
    DumpGSettings: 'read-only',
    DumpCss: 'read-only',
    SwapCss: 'mutating',
} as const satisfies Record<string, MethodKind>;

export type GenericMethodName = keyof typeof GENERIC_METHODS;
