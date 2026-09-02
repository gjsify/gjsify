/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK half of the CONTENT-AND-FEEDBACK group, against the libadwaita that is
// installed.
//
// ONE FILE FOR FIVE WIDGETS. What every GTK spec in this package needs before it can
// assert anything — the realised sized window, the tree search, the diagnostics gate —
// is `../testing/gtk.spec.tsx`; what is per-widget is the reasoning, and that is at each
// `describe`. Five files would be five `describe`s over one import, and the package
// already answers this way: `AdwBin`'s GTK coverage lives in `clamp.gtk.spec.tsx`.
//
// THE ORACLE IS UNUSUALLY DIRECT FOR THE AVATAR, and that is what makes the pair with
// `avatar.native.spec.tsx` worth having. `set_class_color` PUBLISHES its answer:
// libadwaita stamps `color{n}` on the avatar's internal gizmo, so this file reads the
// class off the live GTK tree and the React Native suite asserts the palette entry with
// the same index. Neither side computes what the other computes — one runs the C and one
// runs `@gjsify/adwaita-core`'s port of it, and the index is where they meet.
//
// TWO ASSERTIONS HERE ARE ABOUT A DEFAULT THAT IS NOT THE DECLARED ONE.
// `AdwBanner:use-markup`'s GParamSpec declares TRUE (adw-banner.c:422-425) and
// `ADW_BANNER_DEFAULTS` records that faithfully — but `adw_banner_get_use_markup`
// delegates to `gtk_label_get_use_markup (self->title)` and `adw-banner.ui` never sets it,
// so a freshly constructed banner reads FALSE. Reading it off the real widget rather than
// off the constant is the whole reason this describe exists; the two would otherwise
// disagree in exactly the place a comment would have said they agree.
//
// AND ONE IS ABOUT A UNIT. `Adw.Toast:timeout` counts whole SECONDS and reads back 5 on a
// default toast; `DEFAULT_TOAST_TIMEOUT` counts 5000 MILLISECONDS. The two authorities
// agree on the duration, so the only thing that can be wrong is the conversion — which is
// therefore asserted against libadwaita's own number and not against itself.

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { expect, it } from '@gjsify/unit';
import { blankReason, shotEvidence } from '@gjsify/gtk-host';
import { dumpTree, gtkChildren } from '@gjsify/gtk-host/conformance';
import { AdwToast, DEFAULT_TOAST_TIMEOUT } from '@gjsify/adwaita-core';

import type { AdwToastOverlayHandle } from '../props.js';
import { capture, find, laidOut, typeOf, withGtk } from '../testing/gtk.spec.js';
import { AdwAvatar } from './avatar.gtk.js';
import { AdwBanner } from './banner.gtk.js';
import { AdwButtonContent } from './button-content.gtk.js';
import { AdwSpinner } from './spinner.gtk.js';
import { AdwToastOverlay, adwToastTimeoutSeconds } from './toast-overlay.gtk.js';

/**
 * The frame these widgets are laid out in.
 *
 * Not the harness's default: the spinner rows ask for a 200-point box, and a 200-point
 * frame would measure the window rather than the widget.
 */
const FRAME = { frameWidth: 600, frameHeight: 300 };

/** The spinner box `spinner.native.spec.tsx` asks the same question in. */
const SPINNER_BOX = 200;

/** Every strict descendant of a GType — the count is what proves "one at a time". */
function findAll(root: Gtk.Widget, gtype: string): Gtk.Widget[] {
    const found: Gtk.Widget[] = [];
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === gtype) found.push(widget);
        queue.push(...gtkChildren(widget));
    }
    return found;
}

/** Every `GtkLabel` text under a widget, in tree order. */
function labels(root: Gtk.Widget): string[] {
    return findAll(root, 'GtkLabel').map((label) => (label as Gtk.Label).label);
}

/** The CSS classes on the avatar's internal gizmo, which is where `set_class_color` writes. */
function avatarGizmoClasses(avatar: Gtk.Widget): string[] {
    const gizmo = avatar.get_first_child();
    if (gizmo === null) throw new Error(`the avatar has no child to carry its colour:\n${dumpTree(avatar)}`);
    return [...gizmo.get_css_classes()];
}

export default async () => {
    await withGtk(async ({ gated, display }) => {
        await gated('AdwAvatar is the real Adw.Avatar, and it publishes its colour', async () => {
            await it('derives “AL” and color11 from “Ada Lovelace”, as the port does', async () => {
                laidOut(
                    <AdwAvatar size={48} text="Ada Lovelace" showInitials={true} />,
                    (container) => {
                        const avatar = find(container, 'AdwAvatar') as Adw.Avatar;
                        expect(avatar.size).toBe(48);
                        // `avatarInitials` answers 'AL' and `avatarColorClass` answers 11 for
                        // the same name; `avatar.native.spec.tsx` asserts both off the port.
                        expect(labels(avatar)).toStrictEqual(['AL']);
                        expect(avatarGizmoClasses(avatar)).toStrictEqual(['color11']);
                    },
                    FRAME,
                );
            });

            await it('derives “GH” and color6 from “Grace Hopper” — a different bucket', async () => {
                // A SECOND NAME, because one name agreeing proves the two sides picked
                // the same index once. `g_str_hash` over UTF-8 bytes is the whole
                // derivation, and a renderer hashing UTF-16 code units instead lands on
                // the same bucket for plenty of ASCII names.
                laidOut(
                    <AdwAvatar size={48} text="Grace Hopper" showInitials={true} />,
                    (container) => {
                        const avatar = find(container, 'AdwAvatar') as Adw.Avatar;
                        expect(labels(avatar)).toStrictEqual(['GH']);
                        expect(avatarGizmoClasses(avatar)).toStrictEqual(['color6']);
                    },
                    FRAME,
                );
            });

            await it('keeps the colour but hides the initials without show-initials', async () => {
                // MEASURED, and the browser renderer disagrees with it: libadwaita still
                // stamps the colour class in icon mode, so the circle keeps its gradient
                // and only the label goes away. `avatar.native.spec.tsx` asserts the same
                // pair — background present, initials hidden.
                laidOut(
                    <AdwAvatar size={48} text="Ada Lovelace" />,
                    (container) => {
                        const avatar = find(container, 'AdwAvatar') as Adw.Avatar;
                        expect(avatarGizmoClasses(avatar)).toStrictEqual(['color11']);
                        expect((find(avatar, 'GtkLabel') as Gtk.Label).visible).toBe(false);
                    },
                    FRAME,
                );
            });
        });

        await gated('AdwBanner answers what the widget reads back, not what it declares', async () => {
            await it('leaves use-markup FALSE when omitted, against a pspec that says TRUE', async () => {
                laidOut(
                    <AdwBanner title="Metered connection" revealed={true} />,
                    (container) => {
                        const banner = find(container, 'AdwBanner') as Adw.Banner;
                        // The declared default is TRUE; `adw_banner_get_use_markup` delegates
                        // to the title label and the template never sets it there.
                        expect(banner.useMarkup).toBe(false);
                        expect(banner.revealed).toBe(true);
                    },
                    FRAME,
                );
            });

            await it('shows the button for a non-empty label and hides it for an empty one', async () => {
                laidOut(
                    <AdwBanner title="Metered" buttonLabel="_Undo" revealed={true} />,
                    (container) => {
                        const banner = find(container, 'AdwBanner') as Adw.Banner;
                        expect(banner.buttonLabel).toBe('_Undo');
                        // The template pins the button to `use-underline=True`, so the PAINTED
                        // text drops the marker while the property keeps it — which is why
                        // `bannerButtonText` runs on the other half and not here.
                        expect(find(banner, 'GtkButton').visible).toBe(true);
                    },
                    FRAME,
                );
                laidOut(
                    <AdwBanner title="Metered" revealed={true} />,
                    (container) => {
                        const banner = find(container, 'AdwBanner') as Adw.Banner;
                        expect(find(banner, 'GtkButton').visible).toBe(false);
                    },
                    FRAME,
                );
            });

            await it('carries button-style as the enum member the nick names', async () => {
                laidOut(
                    <AdwBanner title="Metered" buttonLabel="Undo" buttonStyle="suggested" revealed={true} />,
                    (container) => {
                        const banner = find(container, 'AdwBanner') as Adw.Banner;
                        expect(banner.buttonStyle).toBe(Adw.BannerButtonStyle.SUGGESTED);
                    },
                    FRAME,
                );
            });

            await it('fires button-clicked through the prop, which is a GObject signal', async () => {
                let clicked = 0;
                laidOut(
                    <AdwBanner
                        title="Metered"
                        buttonLabel="Undo"
                        revealed={true}
                        onButtonClicked={() => (clicked += 1)}
                    />,
                    (container) => {
                        const banner = find(container, 'AdwBanner') as Adw.Banner;
                        expect(clicked).toBe(0);
                        (find(banner, 'GtkButton') as Gtk.Button).emit('clicked');
                        expect(clicked).toBe(1);
                    },
                    FRAME,
                );
            });
        });

        await gated('AdwSpinner sizes its BOX from GtkWidget’s own request', async () => {
            await it('measures libadwaita’s natural 16 with no request', async () => {
                // `resolveSpinnerSize(undefined)` answers 16 on the other half for the
                // same input, and `spinner.native.spec.tsx` asserts it as a style.
                laidOut(
                    <AdwSpinner />,
                    (container) => {
                        const spinner = find(container, 'AdwSpinner');
                        expect(spinner.measure(Gtk.Orientation.HORIZONTAL, -1)[0]).toBe(16);
                        expect(spinner.measure(Gtk.Orientation.VERTICAL, -1)[0]).toBe(16);
                    },
                    FRAME,
                );
            });

            await it('measures exactly what was requested, with no upper bound', async () => {
                // 200 is the shared frame: the box stays 200 while `spinnerGeometry` caps
                // the RING at 64, and the ring is asserted on the half where it is a node.
                laidOut(
                    <AdwSpinner widthRequest={SPINNER_BOX} heightRequest={SPINNER_BOX} />,
                    (container) => {
                        const spinner = find(container, 'AdwSpinner');
                        expect(spinner.measure(Gtk.Orientation.HORIZONTAL, -1)[0]).toBe(SPINNER_BOX);
                        expect(spinner.get_height()).toBe(SPINNER_BOX);
                    },
                    FRAME,
                );
            });
        });

        // INSIDE A `<gtk-button>`, WHICH IS NOT DECORATION. `adw_button_content_root`
        // takes the nearest `GtkButton` ancestor and, with none, calls
        // `gtk_widget_get_parent (NULL)` and `gtk_widget_add_css_class (NULL, …)`.
        // `buttonContentStyleTargetIndex`'s doc calls that two CRITICALs; measured here it
        // is exactly two, `assertQuiet` failed on them, and this describe is the first
        // thing in the repository to hold libadwaita to it. So the widget is mounted the
        // way it is used, and the class it exists to stamp becomes assertable as well.
        await gated('AdwButtonContent resolves the icon and the label the way the C does', async () => {
            await it('draws image-missing for an empty slot instead of hiding the icon', async () => {
                // libadwaita's own doc comments say the icon is not shown; its code sets
                // the fallback and never hides the image. `buttonContentIconName` follows
                // the code, and this is the widget agreeing.
                laidOut(
                    <gtk-button>
                        <AdwButtonContent />
                    </gtk-button>,
                    (container) => {
                        const content = find(container, 'AdwButtonContent');
                        const image = find(content, 'GtkImage') as Gtk.Image;
                        expect(image.iconName).toBe('image-missing');
                        expect(image.visible).toBe(true);
                        // `buttonContentIconExpands('')` is TRUE, and this is why: with no
                        // label the icon takes the free space and so centres itself.
                        expect(image.hexpand).toBe(true);
                        expect((find(content, 'GtkLabel') as Gtk.Label).visible).toBe(false);
                    },
                    FRAME,
                );
            });

            await it('stamps image-text-button on the button, which is the point of it', async () => {
                // `BUTTON_CONTENT_STYLE_CLASS` carries 9px of horizontal padding where a
                // plain button has 17px, and it is the whole reason `AdwButtonContent`
                // exists as a type rather than as a box. It is libadwaita's own work on
                // this half — there is nothing for the React Native half to stamp it on,
                // because this package ships no button, and the README names that.
                laidOut(
                    <gtk-button>
                        <AdwButtonContent iconName="folder-download-symbolic" label="Save" />
                    </gtk-button>,
                    (container) => {
                        const button = find(container, 'GtkButton');
                        expect([...button.get_css_classes()]).toStrictEqual(['image-text-button']);
                    },
                    FRAME,
                );
            });

            await it('keeps the mnemonic marker in the property and ellipsizes for can-shrink', async () => {
                laidOut(
                    <gtk-button>
                        <AdwButtonContent
                            iconName="folder-download-symbolic"
                            label="_Save"
                            useUnderline={true}
                            canShrink={true}
                        />
                    </gtk-button>,
                    (container) => {
                        const content = find(container, 'AdwButtonContent');
                        const image = find(content, 'GtkImage') as Gtk.Image;
                        const label = find(content, 'GtkLabel') as Gtk.Label;
                        expect(image.iconName).toBe('folder-download-symbolic');
                        expect(image.hexpand).toBe(false);
                        // RAW, marker included: the label node carries `use-underline`
                        // itself and resolves it at paint. The React Native half has no
                        // mnemonic layer, so `buttonContentLabelText` strips it there.
                        expect(label.label).toBe('_Save');
                        // `buttonContentEllipsize(true)` is `'end'`, which is
                        // `PANGO_ELLIPSIZE_END`.
                        expect(label.ellipsize).toBe(3);
                    },
                    FRAME,
                );
            });
        });

        await gated('AdwToastOverlay is libadwaita’s queue, reached through a ref', async () => {
            await it('converts the core’s milliseconds to libadwaita’s seconds', async () => {
                // BOTH SIDES OF THE UNIT, so the conversion is measured against
                // libadwaita's own default rather than against itself: a default
                // `Adw.Toast` reads 5, `DEFAULT_TOAST_TIMEOUT` is 5000 ms. The toast is
                // constructed with NO title, which is not tidiness: a literal caption in
                // a constructor object is what `gjsify/no-literal-widget-label` reports,
                // and the title is not what is being measured.
                expect(new Adw.Toast({}).timeout).toBe(5);
                expect(adwToastTimeoutSeconds(DEFAULT_TOAST_TIMEOUT)).toBe(5);
                // 0 is libadwaita's "until dismissed" and must survive as 0, and no
                // POSITIVE input may reach it — which is what the 400 row is for, and it
                // is the row that falsified `Math.round`: `Math.round(400 / 1000)` is 0,
                // i.e. a 0.4-second toast that never goes away.
                expect(adwToastTimeoutSeconds(0)).toBe(0);
                expect(adwToastTimeoutSeconds(400)).toBe(1);
                expect(adwToastTimeoutSeconds(1500)).toBe(2);
            });

            await it('shows ONE toast for two adds, which is the policy both halves keep', async () => {
                const handle: { current: AdwToastOverlayHandle | null } = { current: null };
                laidOut(
                    <AdwToastOverlay ref={handle}>
                        <gtk-label label="content" />
                    </AdwToastOverlay>,
                    (container) => {
                        const overlay = find(container, 'AdwToastOverlay') as Adw.ToastOverlay;
                        expect(typeOf(overlay.get_child() as Gtk.Widget)).toBe('GtkLabel');
                        expect(findAll(overlay, 'AdwToastWidget').length).toBe(0);

                        handle.current?.addToast(new AdwToast('first', { timeout: 0 }));
                        handle.current?.addToast(new AdwToast('second', { timeout: 0 }));
                        const context = GLib.MainContext.default();
                        while (context.pending()) context.iteration(false);

                        // ONE widget, showing the FIRST — the same pair
                        // `toast-overlay.native.spec.tsx` asserts of the port.
                        expect(findAll(overlay, 'AdwToastWidget').length).toBe(1);
                        expect(labels(overlay)).toContain('first');
                        expect(labels(overlay)).not.toContain('second');
                    },
                    FRAME,
                );
            });

            await it('puts the action button in the toast when the label is non-empty', async () => {
                const handle: { current: AdwToastOverlayHandle | null } = { current: null };
                laidOut(
                    <AdwToastOverlay ref={handle}>
                        <gtk-label label="content" />
                    </AdwToastOverlay>,
                    (container) => {
                        const overlay = find(container, 'AdwToastOverlay') as Adw.ToastOverlay;
                        handle.current?.addToast(new AdwToast('Saved', { timeout: 0, buttonLabel: 'Undo' }));
                        const context = GLib.MainContext.default();
                        while (context.pending()) context.iteration(false);
                        const toast = find(overlay, 'AdwToastWidget');
                        expect(labels(toast)).toContain('Saved');
                        expect(labels(toast)).toContain('Undo');
                    },
                    FRAME,
                );
            });

            await it('reaches dismiss_all without a diagnostic — the only half of it GTK shows', async () => {
                // THE TREE CANNOT ANSWER THIS ONE. `adw_toast_overlay_dismiss_all`
                // animates the strip out, and pumping the main context for ~1.6s of real
                // time leaves the `AdwToastWidget` in place — measured. So what is
                // asserted is that the call lands on libadwaita and costs nothing: this
                // describe's `assertQuiet` is the second half of the assertion. The
                // REMOVAL is asserted on the React Native half, where the queue is ours.
                const handle: { current: AdwToastOverlayHandle | null } = { current: null };
                laidOut(
                    <AdwToastOverlay ref={handle}>
                        <gtk-label label="content" />
                    </AdwToastOverlay>,
                    () => {
                        handle.current?.addToast(new AdwToast('first', { timeout: 0 }));
                        handle.current?.dismissAll();
                        const context = GLib.MainContext.default();
                        while (context.pending()) context.iteration(false);
                    },
                    FRAME,
                );
            });
        });

        if (display !== null) {
            await gated('the picture, not only the setter', async () => {
                // GTK'S FAILURE MODE IS EXIT 0 WITH AN EMPTY WINDOW, so a tree assert and
                // a photograph answer different questions — `clamp.gtk.spec.tsx` carries
                // the four documentation snippets that were measured producing an empty
                // window at exit 0 with zero diagnostics. One row per widget, because a
                // single row that photographs three of them names none of them when it
                // fails.
                await it('rasterises the avatar, gradient and initials and all', async () => {
                    laidOut(
                        <AdwAvatar size={48} text="Ada Lovelace" showInitials={true} />,
                        (container) => {
                            expect(blankReason(shotEvidence(find(container, 'AdwAvatar'), capture))).toBe(null);
                        },
                        FRAME,
                    );
                });

                await it('rasterises the banner through its revealer', async () => {
                    laidOut(
                        <AdwBanner title="Metered connection" revealed={true} />,
                        (container) => {
                            expect(blankReason(shotEvidence(find(container, 'AdwBanner'), capture))).toBe(null);
                        },
                        FRAME,
                    );
                });

                await it('rasterises the spinner, which `blankReason` cannot be asked about', async () => {
                    // `blankReason`'s FIRST question is the strict descendant count, and
                    // `Adw.Spinner` has none: it draws through an `AdwSpinnerPaintable`
                    // and holds no child widget at all. Measured — a spinner allocated
                    // 400×200 reports 0 descendants, so the reader answers "nothing was
                    // rendered" about a widget that renders. That is a property of the
                    // widget, not a failure, so the evidence FIELDS are read directly.
                    //
                    // WITH A CONTROL IN THE ROW, because "a non-empty PNG is not proof" is
                    // `blankReason`'s own warning. `Gtk.Snapshot.to_node()` returns NULL
                    // for a widget that paints nothing, so an empty `Gtk.Box` at the same
                    // allocation captures no PNG at all: box 0 bytes, spinner ~1.4 kB —
                    // the count is not stable, the contrast is.
                    //
                    // THE CONTROL GETS ITS OWN WINDOW, AND THAT IS THE WHOLE POINT OF IT.
                    // It was first written as a `Gtk.Box` appended to the spinner's
                    // container after layout, and measured that way it is 0×0: the box
                    // never gets an allocation, `capture` bails at `width <= 0`, and the
                    // row proved that an UNALLOCATED widget captures nothing — which is
                    // true of every widget, the spinner included. Falsified: swapping the
                    // box for a `Gtk.Button`, which paints a background, left the suite at
                    // exit 0. Laid out in its own window the control discriminates, and
                    // its ALLOCATION is asserted first so it cannot quietly stop.
                    laidOut(
                        <AdwSpinner widthRequest={SPINNER_BOX} heightRequest={SPINNER_BOX} />,
                        (container) => {
                            const spinner = find(container, 'AdwSpinner');
                            const evidence = shotEvidence(spinner, capture);
                            expect(evidence.widgets).toBe(0);
                            expect(evidence.height).toBe(SPINNER_BOX);
                            expect(evidence.bytes > 0).toBe(true);
                        },
                        FRAME,
                    );

                    laidOut(
                        <gtk-box width-request={SPINNER_BOX} height-request={SPINNER_BOX} />,
                        (container) => {
                            const blank = find(container, 'GtkBox');
                            expect(blank.get_height()).toBe(SPINNER_BOX);
                            expect(shotEvidence(blank, capture).bytes).toBe(0);
                        },
                        FRAME,
                    );
                });
            });
        }
    });
};
