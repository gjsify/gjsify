// The one focus trap behind every `aria-modal="true"` surface in this package.
//
// THE INCIDENT
//
// Four elements set `aria-modal="true"`. One of them honoured it. Measured in Firefox
// on a page whose next tabbable element was a view-switcher button: focus the last
// control inside `<adw-alert-dialog>`, press Tab once, and focus landed on
// `.adw-view-switcher-bar-button` — outside the dialog, behind its own scrim, on a
// control the user cannot see. `<adw-about-dialog>` and `<adw-preferences-dialog>` did
// the same. Closing the dialog then left focus there: none of the three returned it to
// whatever opened them, so a keyboard user finished the interaction somewhere they never
// asked to be. `aria-modal` tells assistive technology the rest of the page is inert; it
// changes NOTHING about where the browser sends Tab. Only `<adw-dialog>` implemented the
// half that is not free, and this module is that half, lifted out of it verbatim.
//
// WHY IT IS A MODULE AND NOT A COPY
//
// `aria-modal` — the attribute and the reflected `.ariaModal` property alike — now lives
// HERE and nowhere else, held by the `[trap]` arm of
// `scripts/check-adwaita-keyboard-contract.mjs`. That is what makes a fifth modal surface
// impossible to add without a trap: the declaration and the behaviour it promises are
// the same call.
//
// Reference: refs/libadwaita/src/adw-dialog.c — GTK_ACCESSIBLE_ROLE_DIALOG (:1290) and
// the dialog's own focus handling, which cannot leave the widget because GTK confines
// focus to the presented dialog by construction. The DOM has no such confinement, so it
// is spelled out.
// Reference: refs/libadwaita/src/adw-alert-dialog.c:1103 — GTK_ACCESSIBLE_ROLE_ALERT_DIALOG.
// Reference: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ — the Tab/Shift+Tab
// wrap and the return-focus rule, for the part upstream leaves to the platform.

/**
 * Everything the browser will hand focus to on Tab. `[tabindex="-1"]` is excluded
 * deliberately: it is programmatically focusable and NOT in the tab order, so treating
 * it as a trap boundary would make Tab stop on a scrim.
 */
const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The two roles a modal surface in this package declares. */
export type AdwModalRole = 'dialog' | 'alertdialog';

export interface AdwModalSurfaceInit {
    /**
     * The custom element itself. It receives the keydown listener, because a dialog that
     * moves focus to its HOST — `<adw-preferences-dialog>` does — would otherwise press
     * Tab against a listener on a descendant that never sees the event.
     */
    host: HTMLElement;
    /** The element carrying the role, `aria-modal`, and the boundary focus may not cross. */
    surface: HTMLElement;
    /** The WAI-ARIA role for {@link AdwModalSurfaceInit.surface}. */
    role: AdwModalRole;
    /** Whether the dialog is presented right now. */
    isOpen: () => boolean;
    /** Escape while open. Dismissal is the element's own business (`can-close`, close-response). */
    onEscape: () => void;
    /**
     * Where focus goes on present, when the element wants something other than the first
     * focusable control — `<adw-alert-dialog>` starts on its DEFAULT response, not on the
     * leftmost button. It is handed {@link AdwModalSurface.focusables}, so a rule like
     * "the first control in the content area" is a `find` over that list rather than a
     * second copy of the filter.
     *
     * Returning nothing — or an element that is not in that list — falls back to the
     * first focusable, then to the surface itself.
     */
    initialFocus?: (focusables: readonly HTMLElement[]) => HTMLElement | null | undefined;
}

/**
 * A modal surface: it declares `aria-modal`, keeps Tab inside itself, and gives focus
 * back to whatever had it when the dialog appeared.
 *
 * The element drives it with two calls — {@link present} when it opens and
 * {@link dismiss} when it closes — and keeps its own dismissal rules.
 */
export class AdwModalSurface {
    private readonly _init: AdwModalSurfaceInit;
    /** Focused before `present()`, restored by `dismiss()`. */
    private _previouslyFocused: HTMLElement | null = null;

    constructor(init: AdwModalSurfaceInit) {
        this._init = init;
        init.surface.setAttribute('role', init.role);
        init.surface.setAttribute('aria-modal', 'true');
        // The surface is the fallback focus target, so it has to be able to hold focus
        // even when it contains no control at all. Not in the tab order: -1.
        if (!init.surface.hasAttribute('tabindex')) init.surface.tabIndex = -1;
        init.host.addEventListener('keydown', (event) => this._onKeyDown(event));
    }

    /** The controls inside the surface, in tab order, that a `focus()` can actually reach. */
    focusables(): HTMLElement[] {
        return Array.from(this._init.surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
            // `getClientRects()` and not `hidden`: `<adw-about-dialog>` keeps every
            // navigation page in the DOM and shows one, so the non-visible pages'
            // buttons match the selector, are not `[hidden]`, and cannot take focus.
            // Tabbing onto one silently leaves focus where it was — a trap that lets go.
            (el) => !el.hasAttribute('disabled') && !el.hidden && el.getClientRects().length > 0,
        );
    }

    /**
     * Remember where focus was, then move it inside.
     *
     * SYNCHRONOUS, and that was measured rather than assumed. `<adw-about-dialog>` used to
     * defer this by a `requestAnimationFrame`, which reads as "the sheet is not laid out
     * yet" — it is not. Every element here toggles its `open` class before calling this,
     * so the surface is already displayed; reading `document.activeElement` in the same
     * task that sets `open` finds it inside the dialog for all four. A retry frame would
     * be a branch nothing can reach, and a spec asserting focus one frame late would pass
     * over a dialog that never focused anything at all.
     */
    present(): void {
        const active = document.activeElement;
        this._previouslyFocused = active instanceof HTMLElement && active !== this._init.host ? active : null;
        const focusables = this.focusables();
        // A `??` chain falls through when the element asks for NOTHING, never when it asks
        // for something the browser refuses — so a request is honoured only if it is in the
        // list, the same test the trap uses for its edges. Measured in Firefox before this
        // filter: an `<adw-alert-dialog>` whose default response was DISABLED handed that
        // button back, `focus()` on it was a no-op, and the dialog opened with
        // `document.activeElement` still on the opener OUTSIDE it. The keydown listener
        // sits on the host, so focus never entered, no key ever reached the trap, and a
        // real Escape left `open` true — unreachable and undismissable at once.
        const wanted = this._init.initialFocus?.(focusables);
        const target =
            (wanted && focusables.includes(wanted) ? wanted : undefined) ?? focusables[0] ?? this._init.surface;
        target.focus();
    }

    /** Give focus back to whatever had it before `present()`. */
    dismiss(): void {
        const restore = this._previouslyFocused;
        this._previouslyFocused = null;
        if (restore && restore.isConnected) restore.focus();
    }

    private _onKeyDown(event: KeyboardEvent): void {
        if (!this._init.isOpen()) return;
        if (event.key === 'Escape') {
            event.stopPropagation();
            this._init.onEscape();
            return;
        }
        if (event.key !== 'Tab') return;

        // The INNERMOST open surface owns Tab: a dialog presented from inside another one
        // bubbles its keydown to the outer host, which would re-run this wrap against its
        // own edges and undo the move that just happened.
        event.stopPropagation();

        const focusables = this.focusables();
        if (focusables.length === 0) {
            // Nothing tabbable inside — Tab would leave immediately, so it goes nowhere.
            event.preventDefault();
            this._init.surface.focus();
            return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        // The wrap is asserted at the EDGES only: in between, the browser's own tab order
        // is already correct and intercepting it would break Shift+Tab through a form.
        if (event.shiftKey && (active === first || active === this._init.surface || active === this._init.host)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || active === this._init.host)) {
            event.preventDefault();
            first.focus();
        }
    }
}
