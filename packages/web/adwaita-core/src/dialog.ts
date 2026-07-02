// AdwAlertResponses — headless Libadwaita-style alert-dialog response model.
//
// Mirrors the response half of `Adw.AlertDialog`: a registry of response buttons
// (`add_response(id, label)` + `set_response_appearance`/`set_response_enabled`),
// the default (emphasised) + close (dismissal) response semantics, and the
// resolve-to-chosen-id contract a renderer's `present()` fulfils. It also owns the
// pure decision logic a native two/three-button dialog needs: which response is
// the OK / cancel / neutral slot, and whether the list is too long for a plain
// alert (so the renderer falls back to an action sheet).
//
// This module is PLATFORM-NEUTRAL (ADR 0004 — headless Adwaita core): it presents
// nothing. A renderer owns the platform half — mapping to NativeScript's native
// `confirm()` / `action()`, a browser `<dialog>`, or GTK's `Adw.AlertDialog` — and
// feeds the outcome back through {@link AdwAlertResponses.resolveById} /
// {@link AdwAlertResponses.resolveLabel}, which validate it against the registry
// and fall back to {@link AdwAlertResponses.closeResponse} on dismissal.
//
// Reference: refs/libadwaita/src/adw-alert-dialog.c
//   (add_response, response appearance/enabled, default/close response, response signal).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** Visual emphasis of a response button. Mirrors `Adw.ResponseAppearance`. */
export type AdwResponseAppearance = 'default' | 'suggested' | 'destructive';

/** Optional per-response attributes for {@link AdwAlertResponses.addResponse}. */
export interface AdwResponseOptions {
    /** Emphasis (suggested/destructive). Default `'default'`. Mirrors `set_response_appearance`. */
    appearance?: AdwResponseAppearance;
    /** Whether the response is selectable. Default `true`. Mirrors `set_response_enabled`. */
    enabled?: boolean;
}

/** A registered response button. `id` is what `present()` resolves to. */
export interface AdwAlertResponse {
    /** Stable response id — the value `present()` resolves to. */
    readonly id: string;
    /** Button label shown to the user. */
    label: string;
    /** Visual emphasis. */
    appearance: AdwResponseAppearance;
    /** Whether the response is selectable. */
    enabled: boolean;
}

/**
 * The response list split into the three slots a native two/three-button dialog
 * exposes: the emphasised OK (the default response, or the first), the trailing
 * cancel/close, and an optional middle neutral. Any slot may be absent.
 */
export interface OrderedConfirmResponses {
    ok?: AdwAlertResponse;
    cancel?: AdwAlertResponse;
    neutral?: AdwAlertResponse;
}

/** More than this many responses do not fit a plain two/three-button alert. */
const MAX_CONFIRM_RESPONSES = 3;

/**
 * The headless alert-dialog response model. Holds the heading/body text and the
 * response registry; owns the ordering + validation a renderer's `present()`
 * needs. Renderer-agnostic: compose it inside a platform dialog (e.g. NativeScript
 * `AdwAlertDialog extends Observable`) and delegate the response surface to it.
 */
export class AdwAlertResponses {
    private _heading: string;
    private _body: string;
    private readonly _responses: AdwAlertResponse[] = [];
    private _defaultResponse: string | null = null;
    private _closeResponse = 'close';

    constructor(heading = '', body = '') {
        this._heading = heading ?? '';
        this._body = body ?? '';
    }

    /** The dialog heading (title). */
    get heading(): string {
        return this._heading;
    }

    set heading(value: string) {
        this._heading = value ?? '';
    }

    /** The dialog body text. */
    get body(): string {
        return this._body;
    }

    set body(value: string) {
        this._body = value ?? '';
    }

    /**
     * Register a response button. `id` is what `present()` resolves to; a repeated
     * `id` updates the existing response's label/appearance/enabled in place
     * (mirroring `adw_alert_dialog_add_response` refusing duplicate ids).
     */
    addResponse(id: string, label: string, options: AdwResponseOptions = {}): void {
        const existing = this._responses.find((r) => r.id === id);
        if (existing) {
            existing.label = label;
            if (options.appearance !== undefined) existing.appearance = options.appearance;
            if (options.enabled !== undefined) existing.enabled = options.enabled;
            return;
        }
        this._responses.push({
            id,
            label,
            appearance: options.appearance ?? 'default',
            enabled: options.enabled ?? true,
        });
    }

    /** Register many responses at once (`id, label, id, label, …`). */
    addResponses(...idLabelPairs: string[]): void {
        for (let i = 0; i + 1 < idLabelPairs.length; i += 2) {
            this.addResponse(idLabelPairs[i]!, idLabelPairs[i + 1]!);
        }
    }

    /** Whether a response with `id` is registered. */
    hasResponse(id: string): boolean {
        return this._responses.some((r) => r.id === id);
    }

    /** Set a registered response's visual emphasis. No-op for an unknown id. */
    setResponseAppearance(id: string, appearance: AdwResponseAppearance): void {
        const r = this._responses.find((res) => res.id === id);
        if (r) r.appearance = appearance;
    }

    /** A registered response's emphasis, or `'default'` for an unknown id. */
    getResponseAppearance(id: string): AdwResponseAppearance {
        return this._responses.find((r) => r.id === id)?.appearance ?? 'default';
    }

    /** Enable/disable a registered response. No-op for an unknown id. */
    setResponseEnabled(id: string, enabled: boolean): void {
        const r = this._responses.find((res) => res.id === id);
        if (r) r.enabled = enabled;
    }

    /** Whether a registered response is enabled (`true` for an unknown id). */
    getResponseEnabled(id: string): boolean {
        return this._responses.find((r) => r.id === id)?.enabled ?? true;
    }

    /** The registered responses, in insertion order. */
    get responses(): ReadonlyArray<AdwAlertResponse> {
        return this._responses;
    }

    /** The default (emphasised) response id — the OK slot in a native dialog. */
    get defaultResponse(): string | null {
        return this._defaultResponse;
    }

    set defaultResponse(id: string | null) {
        this._defaultResponse = id;
    }

    /** The response id used when the dialog is dismissed without a choice. */
    get closeResponse(): string {
        return this._closeResponse;
    }

    set closeResponse(id: string) {
        this._closeResponse = id || 'close';
    }

    /**
     * Whether the response list is too long for a plain two/three-button alert
     * (so a renderer falls back to an action sheet). Mirrors the NativeScript
     * `confirm()` (≤3) vs `action()` (>3) split.
     */
    get usesActionSheet(): boolean {
        return this._responses.length > MAX_CONFIRM_RESPONSES;
    }

    /**
     * Split the responses into the native OK / cancel / neutral slots: the default
     * response (or the first) is OK, the LAST remaining is cancel/close, and a
     * middle one (when present) is neutral — the ordering a native two/three-button
     * dialog expects.
     */
    orderResponses(): OrderedConfirmResponses {
        const ok = this._responses.find((r) => r.id === this._defaultResponse) ?? this._responses[0];
        const remaining = this._responses.filter((r) => r !== ok);
        const cancel = remaining[remaining.length - 1];
        const neutral = remaining.length >= 2 ? remaining[0] : undefined;
        return { ok, cancel, neutral };
    }

    /**
     * Resolve a chosen response id to a REGISTERED id — the resolve-to-chosen-id
     * contract. Returns `id` when it names a registered response, otherwise
     * {@link closeResponse} (covering `null` / dismissal / an unknown id).
     */
    resolveById(id: string | null | undefined): string {
        return id != null && this.hasResponse(id) ? id : this._closeResponse;
    }

    /**
     * Resolve a chosen LABEL (e.g. an action-sheet selection) to a registered id,
     * or {@link closeResponse} when the label matches nothing / was dismissed.
     */
    resolveLabel(label: string | null | undefined): string {
        if (label == null) return this._closeResponse;
        return this.resolveById(this._responses.find((r) => r.label === label)?.id);
    }
}
