// @gjsify/devtools-protocol — generic method surface + pause classification.

/**
 * How a method behaves while external control is paused by the host:
 * - `read-only` — observation/diagnostics; always allowed.
 * - `presence`  — an external driver's own awareness channel (cursor/label); allowed.
 * - `mutating`  — edits app state or the user's UI; rejected while paused.
 */
export type MethodKind = 'read-only' | 'presence' | 'mutating';

/**
 * The generic, toolkit-neutral devtools methods and their kinds. Adapters implement the
 * subset they support and the bridge advertises only those; app-specific methods arrive
 * through extensions with their own kinds, and the registry rejects an unclassified name
 * so nothing can bypass the pause policy unnoticed.
 *
 * A NAME HERE IS A PROMISE, so nothing may be listed ahead of an adapter. `SetProperty`
 * and `EmitSignal` were once classified `mutating` here while existing on no wire at all
 * — no XML fragment, no handler, no MCP tool — so a caller read the contract, called
 * them and got `UnknownMethod`, while the pause policy looked complete. Add a method back
 * in the change that lands its adapter, which is the only change that can prove the kind.
 */
export const GENERIC_METHODS = {
    GetStatus: 'read-only',
    Screenshot: 'read-only',
    ListActions: 'read-only',
    ActivateAction: 'mutating',
    ChangeActionState: 'mutating',
    PresentWindow: 'read-only',
    ResizeWindow: 'mutating',
    ListToplevels: 'read-only',
    DumpTree: 'read-only',
    GetProperty: 'read-only',
    GetFocused: 'read-only',
    FindWidget: 'read-only',
    ActivateWidget: 'mutating',
    DumpGSettings: 'read-only',
    DumpCss: 'read-only',
    SwapCss: 'mutating',
} as const satisfies Record<string, MethodKind>;

export type GenericMethodName = keyof typeof GENERIC_METHODS;
