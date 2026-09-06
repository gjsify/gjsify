// AdwAlertDialog — a Libadwaita-style alert dialog for NativeScript.
//
// The RESPONSE MODEL — the response registry (`add_response` id/label/appearance/
// enabled), the default/close-response semantics, the OK/cancel/neutral ordering,
// the action-sheet threshold, and the resolve-to-chosen-id contract — is HEADLESS
// and lives in `@gjsify/adwaita-core` (ADR 0004) as {@link AdwAlertResponses};
// this class composes it and keeps only the NativeScript binding: mapping to the
// platform's native `confirm()` (≤3 responses) / `action()` (>3) and emitting the
// `notify::response` GObject signal. Mirrors `Adw.AlertDialog`: `heading`, `body`,
// `addResponse(id, label)`, `present()` resolving to the chosen response id.
//
// FIDELITY: approximated by design. There is NO custom in-app modal here — the NS
// platform alert/action sheet is used so the dialog looks like the user's OS
// (native Material / UIKit chrome), NOT a pixel-identical libadwaita dialog. This
// is the honest, on-platform choice (the same substitution `AdwComboRow` makes for
// its chooser): blur/scrim/rounded-card styling are the OS's, response BUTTONS and
// the resolve-to-chosen-id contract are faithful to `Adw.AlertDialog`. The
// `confirm()` path supports up to three responses (OK / neutral / cancel); more
// than three fall back to an `action()` sheet. Response `appearance` (suggested/
// destructive) and `enabled` are TRACKED in the headless model but not rendered —
// the native sheet treats all rows equally (a browser / GTK renderer would honour
// them).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-alert-dialog`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_message-dialog.scss (dialog.alert)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { action, confirm, Observable, type EventData } from '@nativescript/core';
import { AdwAlertResponses } from '@gjsify/adwaita-core';
import type { AdwResponseAppearance, AdwResponseOptions } from '@gjsify/adwaita-core';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

// Re-export the headless response model + its types so existing consumers keep
// importing them from `@gjsify/adwaita-nativescript` unchanged.
export { AdwAlertResponses } from '@gjsify/adwaita-core';
export type {
    AdwAlertResponse,
    AdwResponseAppearance,
    AdwResponseOptions,
    OrderedConfirmResponses,
} from '@gjsify/adwaita-core';

/** Event name emitted when a response is chosen. Mirrors GObject `notify::response`. */
export const NOTIFY_RESPONSE = 'notify::response';

/** Payload of the `notify::response` event. */
export interface NotifyResponseEventData extends EventData {
    /** The chosen response id. */
    response: string;
}

export class AdwAlertDialog extends Observable {
    /** The headless response registry + ordering + resolution (ADR 0004). */
    private readonly _responses: AdwAlertResponses;

    constructor(heading = '', body = '', props?: ConstructProps<AdwAlertDialog>) {
        super();
        this._responses = new AdwAlertResponses(heading, body);

        applyConstructProps(this, props);
    }

    /** The dialog heading (title). */
    get heading(): string {
        return this._responses.heading;
    }

    set heading(value: string) {
        this._responses.heading = value;
    }

    /** The dialog body text. */
    get body(): string {
        return this._responses.body;
    }

    set body(value: string) {
        this._responses.body = value;
    }

    /** Register a response button (`id` is what `present()` resolves to). */
    addResponse(id: string, label: string, options?: AdwResponseOptions): void {
        this._responses.addResponse(id, label, options);
    }

    /** Register many responses at once (`id, label, id, label, …`). */
    addResponses(...idLabelPairs: string[]): void {
        this._responses.addResponses(...idLabelPairs);
    }

    /** Set a registered response's visual emphasis (suggested/destructive). */
    setResponseAppearance(id: string, appearance: AdwResponseAppearance): void {
        this._responses.setResponseAppearance(id, appearance);
    }

    /** A registered response's emphasis (`'default'` for an unknown id). */
    getResponseAppearance(id: string): AdwResponseAppearance {
        return this._responses.getResponseAppearance(id);
    }

    /** Enable/disable a registered response. */
    setResponseEnabled(id: string, enabled: boolean): void {
        this._responses.setResponseEnabled(id, enabled);
    }

    /** Whether a registered response is enabled (`true` for an unknown id). */
    getResponseEnabled(id: string): boolean {
        return this._responses.getResponseEnabled(id);
    }

    /** The default (emphasised) response id, used as the OK button in `confirm()`. */
    get defaultResponse(): string | null {
        return this._responses.defaultResponse;
    }

    set defaultResponse(id: string | null) {
        this._responses.defaultResponse = id;
    }

    /** The response id used when the dialog is dismissed without a choice. */
    get closeResponse(): string {
        return this._responses.closeResponse;
    }

    set closeResponse(id: string) {
        this._responses.closeResponse = id;
    }

    /** The registered responses. */
    get responses(): AdwAlertResponses['responses'] {
        return this._responses.responses;
    }

    /**
     * Present the dialog. Resolves to the chosen response id (or {@link closeResponse}
     * on dismissal). Uses a native `confirm()` for ≤3 responses, else an `action()`
     * sheet.
     */
    async present(): Promise<string> {
        const chosen = this._responses.usesActionSheet ? await this._presentAction() : await this._presentConfirm();
        this.notify({ eventName: NOTIFY_RESPONSE, object: this, response: chosen } as NotifyResponseEventData);
        return chosen;
    }

    private async _presentConfirm(): Promise<string> {
        // Core assigns the slots (default→OK, last→cancel, middle→neutral); this
        // maps the native `confirm()` tri-state back onto them.
        const ordered = this._responses.orderResponses();
        const result = await confirm({
            title: this._responses.heading || undefined,
            message: this._responses.body || undefined,
            okButtonText: ordered.ok?.label,
            cancelButtonText: ordered.cancel?.label,
            neutralButtonText: ordered.neutral?.label,
            cancelable: true,
        });
        // confirm resolves true (OK) / false (cancel) / undefined (neutral|dismiss).
        if (result === true) return this._responses.resolveById(ordered.ok?.id);
        if (result === false) return this._responses.resolveById(ordered.cancel?.id);
        if (result === undefined) return this._responses.resolveById(ordered.neutral?.id);
        return this._responses.closeResponse;
    }

    private async _presentAction(): Promise<string> {
        const chosenLabel = await action({
            title: this._responses.heading || undefined,
            message: this._responses.body || undefined,
            cancelButtonText: 'Cancel',
            actions: this._responses.responses.map((r) => r.label),
        });
        return this._responses.resolveLabel(chosenLabel);
    }
}
