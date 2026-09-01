// @gjsify/devtools — the app-specific extension + install option types.

import type Gio from 'gi://Gio?version=2.0';
import type { MethodKind } from '@gjsify/devtools-protocol';

/**
 * App-specific extension of the devtools control plane: extra DBus methods (the
 * map-editor's PaintTile, say) without forking the generic core. The `<method>` XML is
 * merged into `org.gjsify.Devtools`, the handlers attach as concrete methods taking
 * positional DBus args, and each carries a pause classification the guard enforces.
 */
export interface DevtoolsExtension {
    /** `<method>…</method>` XML fragments merged into the interface. */
    readonly methodsXml?: readonly string[];
    /** Concrete DBus method implementations, keyed by the XML method name. Receive positional args. */
    readonly handlers: Record<string, (...args: never[]) => unknown>;
    /** Pause classification for each handler (the guard rejects an unclassified name). */
    readonly methodKinds: Record<string, MethodKind>;
    /** Extra keys merged into `GetStatus()`. */
    readonly contributeStatus?: () => Record<string, unknown>;
}

/** Options for {@link installDevtools}. */
export interface InstallDevtoolsOptions {
    /** Force-enable regardless of `GJSIFY_DEVTOOLS` (e.g. a dev-only build). Default: env-gated. */
    enabled?: boolean;
    /** Per-instance label (multi-instance side-by-side). Default: the `GJSIFY_DEVTOOLS_INSTANCE` env var. */
    instance?: string;
    /**
     * D-Bus address to LISTEN on for the bus-less peer-to-peer transport
     * (`unix:tmpdir=/tmp`, `unix:path=/tmp/app.sock`, `nonce-tcp:host=127.0.0.1`).
     * Takes precedence over the session bus. Default: the
     * `GJSIFY_DEVTOOLS_ADDRESS` env var; with neither, the session bus is used
     * when it answers and a socket is auto-picked when it does not — the full
     * precedence table lives on `chooseDevtoolsTransport`.
     */
    address?: string;
    /** App-specific extensions. */
    extend?: readonly DevtoolsExtension[];
    /**
     * Action group for `win.*` when the active window does not implement
     * `Gio.ActionGroup` itself — i.e. `Adw.ApplicationWindow`, which (unlike
     * `Gtk.ApplicationWindow`) does not expose its `win.*` actions as a group.
     */
    winActionGroup?: Gio.ActionGroup;
    /** Predicate the pause guard consults; mutating methods are rejected when it returns true. */
    paused?: () => boolean;
}
