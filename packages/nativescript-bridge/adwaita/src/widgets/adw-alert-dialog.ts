// AdwAlertDialog — a Libadwaita-style alert dialog for NativeScript.
//
// Backed by the platform's native dialogs (`confirm()` for ≤3 responses, mapped to
// OK/cancel/neutral; `action()` for an arbitrary response list). Mirrors
// `Adw.AlertDialog`: `heading`, `body`, `addResponse(id, label)`, `present()`
// resolving to the chosen response id, and a `notify::response` event.
//
// FIDELITY: approximated by design. There is NO custom in-app modal here — the NS
// platform alert/action sheet is used so the dialog looks like the user's OS
// (native Material / UIKit chrome), NOT a pixel-identical libadwaita dialog. This
// is the honest, on-platform choice (the same substitution `AdwComboRow` makes for
// its chooser): blur/scrim/rounded-card styling are the OS's, response BUTTONS and
// the resolve-to-chosen-id contract are faithful to `Adw.AlertDialog`. The
// `confirm()` path supports up to three responses (OK / neutral / cancel); more
// than three fall back to an `action()` sheet (no default/destructive emphasis
// since the sheet treats all rows equally).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-alert-dialog`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialog.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { action, confirm, Observable, type EventData } from '@nativescript/core';

/** Event name emitted when a response is chosen. Mirrors GObject `notify::response`. */
export const NOTIFY_RESPONSE = 'notify::response';

/** Payload of the `notify::response` event. */
export interface NotifyResponseEventData extends EventData {
    /** The chosen response id. */
    response: string;
}

interface ResponseInfo {
    id: string;
    label: string;
}

export class AdwAlertDialog extends Observable {
    private _heading = '';
    private _body = '';
    private readonly _responses: ResponseInfo[] = [];
    private _defaultResponse: string | null = null;
    private _closeResponse = 'close';

    constructor(heading = '', body = '') {
        super();
        this._heading = heading;
        this._body = body;
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

    /** Register a response button (`id` is what `present()` resolves to). */
    addResponse(id: string, label: string): void {
        this._responses.push({ id, label });
    }

    /** Register many responses at once (`id, label, id, label, …`). */
    addResponses(...idLabelPairs: string[]): void {
        for (let i = 0; i + 1 < idLabelPairs.length; i += 2) {
            this.addResponse(idLabelPairs[i]!, idLabelPairs[i + 1]!);
        }
    }

    /** The default (emphasised) response id, used as the OK button in `confirm()`. */
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

    /** The registered responses. */
    get responses(): ReadonlyArray<ResponseInfo> {
        return this._responses;
    }

    /**
     * Present the dialog. Resolves to the chosen response id (or {@link closeResponse}
     * on dismissal). Uses a native `confirm()` for ≤3 responses, else an `action()`
     * sheet.
     */
    async present(): Promise<string> {
        const chosen = this._responses.length <= 3 ? await this._presentConfirm() : await this._presentAction();
        this.notify({ eventName: NOTIFY_RESPONSE, object: this, response: chosen } as NotifyResponseEventData);
        return chosen;
    }

    private async _presentConfirm(): Promise<string> {
        // Order: default (OK) first, close/cancel last, the remainder = neutral.
        const ordered = this._orderResponses();
        const okButtonText = ordered.ok?.label;
        const cancelButtonText = ordered.cancel?.label;
        const neutralButtonText = ordered.neutral?.label;

        const result = await confirm({
            title: this._heading || undefined,
            message: this._body || undefined,
            okButtonText,
            cancelButtonText,
            neutralButtonText,
            cancelable: true,
        });
        // confirm resolves true (OK) / false (cancel) / undefined (neutral|dismiss).
        if (result === true && ordered.ok) return ordered.ok.id;
        if (result === false && ordered.cancel) return ordered.cancel.id;
        if (result === undefined && ordered.neutral) return ordered.neutral.id;
        return this._closeResponse;
    }

    private _orderResponses(): {
        ok?: ResponseInfo;
        cancel?: ResponseInfo;
        neutral?: ResponseInfo;
    } {
        const byId = (id: string | null) => this._responses.find((r) => r.id === id);
        const ok = byId(this._defaultResponse) ?? this._responses[0];
        const remaining = this._responses.filter((r) => r !== ok);
        // Last remaining = cancel/close; middle (if any) = neutral.
        const cancel = remaining[remaining.length - 1];
        const neutral = remaining.length >= 2 ? remaining[0] : undefined;
        return { ok, cancel, neutral };
    }

    private async _presentAction(): Promise<string> {
        const labels = this._responses.map((r) => r.label);
        const chosenLabel = await action({
            title: this._heading || undefined,
            message: this._body || undefined,
            cancelButtonText: 'Cancel',
            actions: labels,
        });
        const found = this._responses.find((r) => r.label === chosenLabel);
        return found?.id ?? this._closeResponse;
    }
}
