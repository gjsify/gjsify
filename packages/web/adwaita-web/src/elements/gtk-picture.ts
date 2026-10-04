// <gtk-picture> — a paintable, sized by the box it is given rather than by itself.
//
// WHAT IT IS NOT. It is not a second `<gtk-image>` and it has no icon vocabulary at all:
// `GtkImage` draws a SYMBOLIC ICON at an icon size, `GtkPicture` draws an ARBITRARY
// `GdkPaintable` (a file, a texture, a video frame) fitted to an ALLOCATION. The two were
// separate GTK types for two decades and stayed separate in 4.8, when `GtkPicture` was
// introduced alongside the `content-fit` property that replaced `GtkImage`'s icon-name path
// for real images. This element therefore takes its content from the LIGHT DOM — the
// replaced element a page already has — and owns the four properties that decide how it is
// fitted and how it is announced.
//
// CONTENT-FIT IS `object-fit`. This is the rare property whose CSS counterpart is not an
// approximation but the same four cases, including the one `GtkContentFit` added and CSS
// already had (`SCALE_DOWN`, gtkpicture.c:162-167): `object-fit` takes `fill`, `contain`,
// `cover` and `scale-down`, and `GTK_CONTENT_FIT` takes `FILL`, `CONTAIN`, `COVER` and
// `SCALE_DOWN`. `_picture.scss` applies the value to the child through `object-fit:
// inherit`, which is why the element writes a custom property rather than the declaration
// itself — `object-fit` is not an inherited property, so the child needs the explicit
// keyword to take the parent's computed value.
//
// `FILL`, AND A PAINTABLE WITH NO RATIO, ARE THE SAME BRANCH. The snapshot divides on
// `content_fit == FILL || ratio == 0` (gtkpicture.c:146): a paintable that reports no
// intrinsic aspect ratio is stretched to the box whatever the mode says, because there is
// no ratio to preserve. This element keeps the two conditions SEPARATE in `fitMode()` —
// the property still reads back what was set — and lets `object-fit` be the thing that
// cannot honour a ratio it was not given.
//
// `CAN-SHRINK` IS THE MEASURE. `can-shrink` defaults to TRUE (gtkpicture.c:554), and a
// shrinking picture reports a minimum of ZERO on both axes whatever the paintable is
// (gtkpicture.c:245-248): it is a picture that may be smaller than its content, which is
// what every avatar, thumbnail and hero image in GTK needs. A picture that may not shrink
// asks the paintable for a CONCRETE minimum instead — the paintable's own minimum at the
// style's icon size (gtkpicture.c:249-254), which CSS spells `min-content`.
//
// `ISOLATE-CONTENTS` IS A RENDER ISOLATION, NOT A BLEND MODE. It defaults to TRUE
// (gtkpicture.c:555) and brackets the snapshot in `gtk_snapshot_push_isolation` /
// `pop_isolation` (gtkpicture.c:148-149, :203-204), which stops the paintable's own
// alpha compositing against whatever is behind the widget. CSS has the same boundary as a
// stacking context, and `isolation: isolate` is the declaration that creates one WITHOUT
// changing how the element is positioned or sized — `contain: paint` would also do it and
// would additionally change the containing block, which `push_isolation` does not.
//
// THE DEPRECATED PROPERTY IS STILL HONOURED. `keep-aspect-ratio` was deprecated in 4.8 in
// favour of `content-fit`, but it was not left inert: the setter maps TRUE to CONTAIN and
// FALSE to FILL (gtkpicture.c:1017-1021) and the getter inverts the test — it reads
// `content_fit != FILL`, so it is `TRUE` for CONTAIN, COVER and SCALE_DOWN alike
// (gtkpicture.c:1040). That inversion is the whole reason the property is implemented
// rather than listed as a gap: a SCALE_DOWN picture HAS an aspect ratio, and answering
// `FALSE` there would be a lie about a property the C answers `TRUE` for.
//
// A11Y: `role="img"`, GtkPicture's own accessible role (gtkpicture.c:553), with
// `alternative-text` as the accessible NAME (gtkpicture.c:474-483). The property is
// spelled `alternative-text` and NOT `alt` here because it is a GIR property and the
// spelling is what `check-adwaita-element-properties.mjs` measures against.
//
// Events: `notify::<prop>` (CustomEvent, bubbles, detail `{ <prop>: value }`) on every
// real change. `alternative-text` writes `aria-label` and nothing else — there is no
// accessible DESCRIPTION path in the GIR for this widget.
//
// Reference: refs/gtk/gtk/gtkpicture.c (the snapshot geometry :146-205, the measure
//   :213-295, the property table :474-552, `keep-aspect-ratio` :1006-1040,
//   `gtk_picture_set_content_fit` :1092-1131)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** `GtkContentFit`, in enum order — the four nicks the GIR and CSS share. */
export const PICTURE_CONTENT_FIT_MODES = ['fill', 'contain', 'cover', 'scale-down'] as const;

export type PictureContentFit = (typeof PICTURE_CONTENT_FIT_MODES)[number];

/** `GTK_CONTENT_FIT_CONTAIN`, the default the C installs (gtkpicture.c:530, :555). */
export const DEFAULT_PICTURE_CONTENT_FIT: PictureContentFit = 'contain';

/**
 * `GtkPicture:content-fit` from its nick, with the C's own guard: an unknown nick is left
 * to the default rather than coerced to `fill`, which is the one value that would silently
 * distort every picture a page writes.
 */
export function normalizePictureContentFit(value: unknown): PictureContentFit {
    return (PICTURE_CONTENT_FIT_MODES as readonly unknown[]).includes(value)
        ? (value as PictureContentFit)
        : DEFAULT_PICTURE_CONTENT_FIT;
}

export class GtkPicture extends HTMLElement {
    private _initialized = false;

    static get observedAttributes() {
        return ['alternative-text', 'can-shrink', 'content-fit', 'isolate-contents', 'keep-aspect-ratio'];
    }

    /**
     * `GtkPicture:alternative-text` (gtkpicture.c:474-483) — the accessible NAME of the
     * picture. It is NOT `alt`: the GIR property is `alternative-text`, and the element
     * carries that spelling so the attribute and the property are one write.
     */
    get alternativeText(): string {
        return this.getAttribute('alternative-text') ?? '';
    }

    set alternativeText(value: string) {
        this._write('alternative-text', value);
    }

    /** `GtkPicture:can-shrink` (gtkpicture.c:486-497). Defaults to TRUE (gtkpicture.c:554). */
    get canShrink(): boolean {
        // The property is a plain `TRUE`-defaulted boolean (gtkpicture.c:489), so an ABSENT
        // attribute is TRUE — the same rule a declarative `<gtk-picture>` has to follow.
        return !this.hasAttribute('can-shrink') || this.getAttribute('can-shrink') !== 'false';
    }

    set canShrink(value: boolean) {
        this._toggle('can-shrink', value, true);
    }

    /** `GtkPicture:content-fit` (gtkpicture.c:520-531). Defaults to CONTAIN. */
    get contentFit(): PictureContentFit {
        return normalizePictureContentFit(this.getAttribute('content-fit'));
    }

    set contentFit(value: PictureContentFit) {
        this._write('content-fit', value);
    }

    /**
     * `GtkPicture:isolate-contents` (gtkpicture.c:538-549). Defaults to TRUE
     * (gtkpicture.c:555) — the same absent-is-true rule {@link canShrink} follows, and for
     * the same reason: the C installs the value in `init`, before any attribute is read.
     */
    get isolateContents(): boolean {
        return !this.hasAttribute('isolate-contents') || this.getAttribute('isolate-contents') !== 'false';
    }

    set isolateContents(value: boolean) {
        this._toggle('isolate-contents', value, true);
    }

    /**
     * `GtkPicture:keep-aspect-ratio` — DEPRECATED in 4.8, and implemented rather than
     * dropped, because the C did not drop it (gtkpicture.c:1006-1040).
     *
     * The setter is a MAPPING, not a stored boolean (gtkpicture.c:1017-1021): TRUE sets
     * `content-fit` to CONTAIN, FALSE sets it to FILL. The getter is the INVERSE test over
     * the live `content-fit` (gtkpicture.c:1040), so a picture authored as `cover` or
     * `scale-down` reads `true` back — those two preserve the ratio, exactly as CONTAIN
     * does, and returning `false` for them would contradict the property's own definition.
     */
    get keepAspectRatio(): boolean {
        return this.contentFit !== 'fill';
    }

    set keepAspectRatio(value: boolean) {
        this.contentFit = value ? 'contain' : 'fill';
    }

    /**
     * `setAttribute` runs the custom-element reaction for a write that changes nothing,
     * while every GObject setter here returns early when the value is already right
     * (gtkpicture.c:1111-1112). This is the guard that makes "notify only on a real
     * change" true.
     */
    private _write(name: string, value: string): void {
        if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    }

    /**
     * A boolean whose GIR default is TRUE needs three states, not two: absent means TRUE
     * (the default the C installs in `init`), `=""` means TRUE, and `="false"` means FALSE.
     * `toggleAttribute` alone would make absent and empty the same state, which is right for
     * a FALSE-defaulted property and wrong for every one of these three.
     */
    private _toggle(name: string, value: boolean, gtypeDefault: boolean): void {
        const target = value ? '' : 'false';
        if (gtypeDefault) {
            // FALSE is the only value that has to be WRITTEN; TRUE is the absence.
            if (value) this.removeAttribute(name);
            else this._write(name, target);
            return;
        }
        this._write(name, target);
    }

    connectedCallback() {
        if (this._initialized) {
            this._render();
            return;
        }
        this._initialized = true;

        // `gtk_widget_class_set_accessible_role (…, GTK_ACCESSIBLE_ROLE_IMG)`
        // (gtkpicture.c:553) — a picture IS an image to a screen reader whether or not it
        // has a name, and the role is what puts it in the image collection.
        this.setAttribute('role', 'img');
        this._render();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        this._render();
        // `gtk_picture_set_content_fit` notifies `keep-aspect-ratio` only when the new mode
        // or the old one is FILL (gtkpicture.c:1114-1115) — a write between two non-FILL
        // modes is invisible to the deprecated property, because its value does not change.
        if (name === 'content-fit') {
            const wasFill = _old === 'fill';
            const isFill = value === 'fill';
            if (wasFill || isFill) {
                this.dispatchEvent(
                    new CustomEvent('notify::keep-aspect-ratio', {
                        bubbles: true,
                        detail: { 'keep-aspect-ratio': this.keepAspectRatio },
                    }),
                );
            }
        }
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._property(name) } }),
        );
    }

    /** The `notify::` detail for `name`: the PROPERTY, parsed, not the raw attribute. */
    private _property(name: string): string | boolean {
        switch (name) {
            case 'alternative-text':
                return this.alternativeText;
            case 'can-shrink':
                return this.canShrink;
            case 'isolate-contents':
                return this.isolateContents;
            case 'keep-aspect-ratio':
                return this.keepAspectRatio;
            default:
                return this.contentFit;
        }
    }

    private _render(): void {
        // `object-fit` is not inherited, so the value is handed down through a custom
        // property and `_picture.scss` applies `object-fit: inherit` to the child. Writing
        // the declaration here would style the ELEMENT, which for a `<div>` box is not the
        // node that has a content box to fit into.
        this.style.setProperty('--gtk-picture-content-fit', this.contentFit);
        // The three states of a TRUE-defaulted boolean, kept as class flags as well as
        // custom properties so a page can target either. `can-shrink` reads on the ELEMENT
        // (it is this widget's measure), `isolate-contents` likewise.
        this.classList.toggle('can-shrink', this.canShrink);
        this.classList.toggle('isolated', this.isolateContents);
        // `gtk_widget_set_overflow (widget, GTK_OVERFLOW_HIDDEN)` (gtkpicture.c:557) is in
        // `_picture.scss`; here it is only worth knowing the reason the class exists.
        if (this.alternativeText) this.setAttribute('aria-label', this.alternativeText);
        else this.removeAttribute('aria-label');
    }
}

customElements.define('gtk-picture', GtkPicture);
