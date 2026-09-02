/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK half of the NAVIGATION group, against the libadwaita that is installed.
//
// ONE FILE FOR SIX WIDGETS, for the reason `content.gtk.spec.tsx` gives: what every GTK
// spec here needs before it can assert anything — the realised sized window, the tree
// search, the diagnostics gate — is `../testing/gtk.spec.tsx`, and what is per-widget is
// the reasoning at each `describe`.
//
// THE NUMBERS ARE SHARED WITH THE FOUR `*.native.spec.tsx` FILES OF THIS GROUP, which is
// what makes each widget one widget rather than two that compile. A 1000-point frame
// gives both split views a 250-point sidebar and a 750-point content pane; a COLLAPSED
// overlay in a 360-point frame gives a 280-point sidebar where a quarter would be 90.
// Neither renderer invented those — `resolveNavigationSidebarWidth`,
// `resolveOverlaySidebarWidth` and `layoutOverlaySplitView` are ports of the C, and this
// file reads the answers off the live GTK tree.
//
// AND ONE NUMBER IS DELIBERATELY GTK-ONLY: the view's own MINIMUM, `sidebar_min +
// content_min`, which `measureSplitViewHorizontal` computes and only a renderer with a
// measure pass can be asked for. The React Native half has none — that is the `childMin`
// divergence `AdwClamp` already carries — so a component there never reports a minimum
// upwards and can be squeezed where GTK refuses.
//
// `sidebar-width-unit` IS WRITTEN AS `px` IN EVERY SIZED CASE, and that is a measurement
// decision rather than a style. The property defaults to `sp`, which
// `adw_length_unit_to_px` scales by `gtk-xft-dpi` — so at any text scale other than 96
// dpi the SAME authored 180/280 is a different number of pixels, and the pair with the
// React Native suite would fail on a machine with large text rather than on a bug.
//
// THE TREE ASSERTIONS READ THE PROPERTY, NOT A CHILD SEARCH, wherever libadwaita offers
// one. `Adw.NavigationSplitView:sidebar` IS the page that was installed, so reading it
// back proves `set_sidebar` was called with the wrapped page — where `find(…,
// 'AdwNavigationPage')` would return whichever page the breadth-first walk reached first
// and pass with the panes swapped.

import Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';
import { expect, it } from '@gjsify/unit';
import { blankReason, shotEvidence } from '@gjsify/gtk-host';
import { measureSplitViewHorizontal, resolveOverlaySidebarWidth, resolveSidebarBounds } from '@gjsify/adwaita-core';

import type { AdwNavigationViewHandle } from '../props.js';
import { FRAME_WIDTH, capture, find, laidOut, typeOf, withGtk } from '../testing/gtk.spec.js';
import { AdwNavigationPage } from './navigation-page.gtk.js';
import { AdwNavigationSplitView } from './navigation-split-view.gtk.js';
import { AdwNavigationView } from './navigation-view.gtk.js';
import { AdwOverlaySplitView } from './overlay-split-view.gtk.js';
import { AdwViewStack } from './view-stack.gtk.js';
import { AdwViewSwitcher } from './view-switcher.gtk.js';

/** The narrow frame a collapsed overlay is measured in — a phone, in points. */
const PHONE_FRAME_WIDTH = 360;

/** The frame the two width rules disagree in. */
const SQUEEZED_FRAME_WIDTH = 300;

/** A content pane wide enough to squeeze the sidebar — the `content_min` of the C. */
const CONTENT_MINIMUM = 200;

/** The allocated width of `widget`, in the coordinate space of `within`. */
function allocatedWidth(widget: Gtk.Widget, within: Gtk.Widget): number {
    const bounds = widget.compute_bounds(within);
    // `compute_bounds` returns `[ok, rect]`; a false `ok` means the two widgets share no
    // common ancestor, which would otherwise read as a width of whatever the stale rect
    // held.
    expect(bounds[0]).toBe(true);
    return Math.round(bounds[1].get_width());
}

export default async () => {
    await withGtk(async ({ gated, display }) => {
        await gated('the widgets are the real libadwaita ones', async () => {
            await it('renders AdwNavigationPage as an Adw.NavigationPage carrying its three properties', async () => {
                laidOut(
                    <AdwNavigationPage title="Home" tag="home" canPop={false}>
                        <gtk-label label="inside" />
                    </AdwNavigationPage>,
                    (container) => {
                        const page = find(container, 'AdwNavigationPage') as Adw.NavigationPage;
                        expect(page.title).toBe('Home');
                        expect(page.tag).toBe('home');
                        expect(page.canPop).toBe(false);
                        expect(typeOf(page.get_child() as Gtk.Widget)).toBe('GtkLabel');
                    },
                );
            });

            await it('adds the declared pages and auto-pushes the first one', async () => {
                laidOut(
                    <AdwNavigationView animateTransitions={false}>
                        <AdwNavigationPage title="Home" tag="home">
                            <gtk-label label="home" />
                        </AdwNavigationPage>
                        <AdwNavigationPage title="Detail" tag="detail">
                            <gtk-label label="detail" />
                        </AdwNavigationPage>
                    </AdwNavigationView>,
                    (container) => {
                        const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                        // `add_page` auto-pushes into an EMPTY stack, so page 0 is
                        // visible with nobody having pushed it — and page 1 is reachable
                        // by tag without being on screen.
                        expect(view.get_visible_page_tag()).toBe('home');
                        expect(view.find_page('detail')).not.toBe(null);
                        expect(view.animateTransitions).toBe(false);
                    },
                );
            });

            await it('wraps both split-view panes in an Adw.NavigationPage carrying the tag', async () => {
                laidOut(
                    <AdwNavigationSplitView
                        sidebar={<gtk-label label="sidebar" />}
                        sidebarTag="sidebar"
                        sidebarTitle="Sidebar"
                        contentTag="content"
                        contentTitle="Content"
                    >
                        <gtk-label label="content" />
                    </AdwNavigationSplitView>,
                    (container) => {
                        const view = find(container, 'AdwNavigationSplitView') as Adw.NavigationSplitView;
                        const sidebar = view.sidebar as Adw.NavigationPage;
                        const content = view.content as Adw.NavigationPage;
                        expect(typeOf(sidebar)).toBe('AdwNavigationPage');
                        expect(typeOf(content)).toBe('AdwNavigationPage');
                        expect(sidebar.tag).toBe('sidebar');
                        expect(content.tag).toBe('content');
                        expect(sidebar.title).toBe('Sidebar');
                        expect(typeOf(sidebar.get_child() as Gtk.Widget)).toBe('GtkLabel');
                    },
                );
            });

            await it('gives Adw.OverlaySplitView plain widgets and its own properties', async () => {
                laidOut(
                    <AdwOverlaySplitView sidebar={<gtk-label label="sidebar" />} pinSidebar={true} collapsed={true}>
                        <gtk-label label="content" />
                    </AdwOverlaySplitView>,
                    (container) => {
                        const view = find(container, 'AdwOverlaySplitView') as Adw.OverlaySplitView;
                        expect(view.collapsed).toBe(true);
                        expect(view.pinSidebar).toBe(true);
                        // PINNED, so collapsing did NOT hide it — the coupling the
                        // React Native half runs through `OverlaySplitViewState`.
                        expect(view.showSidebar).toBe(true);
                        // No `Adw.NavigationPage` here: these two slots take `GtkWidget`.
                        expect(typeOf(view.sidebar as Gtk.Widget)).toBe('GtkBox');
                    },
                );
            });

            await it('pins and collapses in ONE commit without losing the sidebar', async () => {
                // THE WRITE ORDER, AS A THING THAT GOES RED, and the twin of the row of
                // the same name in `overlay-split-view.native.spec.tsx`.
                // `adw_overlay_split_view_set_collapsed` calls `set_show_sidebar (self,
                // !collapsed, …)` for an UNPINNED sidebar, so `collapsed` has to be
                // written after `pin-sidebar` — and gtk-host writes props in ELEMENT
                // order, on the update path from `Object.keys(newProps)` and at mount
                // from the insertion order `g_object_new_with_properties` preserves. The
                // mount case is covered by the row above, which authors both flags at
                // once; this one changes both in a single commit, which is the case that
                // depends on nothing but the order two JSX attributes are written in.
                laidOut(
                    <AdwOverlaySplitView sidebar={<gtk-label label="sidebar" />}>
                        <gtk-label label="content" />
                    </AdwOverlaySplitView>,
                    (container, _window, rerender) => {
                        const view = find(container, 'AdwOverlaySplitView') as Adw.OverlaySplitView;
                        expect(view.showSidebar).toBe(true);
                        rerender(
                            <AdwOverlaySplitView
                                sidebar={<gtk-label label="sidebar" />}
                                pinSidebar={true}
                                collapsed={true}
                            >
                                <gtk-label label="content" />
                            </AdwOverlaySplitView>,
                        );
                        expect(view.collapsed).toBe(true);
                        expect(view.pinSidebar).toBe(true);
                        // Pinned BEFORE collapsing, so the collapse left it alone.
                        expect(view.showSidebar).toBe(true);
                    },
                );
            });

            await it('writes the seven Adw.ViewStackPage properties add_titled cannot carry', async () => {
                laidOut(
                    <AdwViewStack
                        pages={[
                            { name: 'home', title: 'Home', child: <gtk-label label="home" /> },
                            {
                                name: 'detail',
                                title: 'Detail',
                                iconName: 'go-next-symbolic',
                                badgeNumber: 3,
                                needsAttention: true,
                                child: <gtk-label label="detail" />,
                            },
                        ]}
                    />,
                    (container) => {
                        const stack = find(container, 'AdwViewStack') as Adw.ViewStack;
                        // The auto-pick: the first VISIBLE page, selected by libadwaita
                        // itself, which is what `ViewStackState` reproduces.
                        expect(stack.visibleChildName).toBe('home');
                        const detail = stack.get_page(stack.get_child_by_name('detail') as Gtk.Widget);
                        expect(detail.title).toBe('Detail');
                        expect(detail.iconName).toBe('go-next-symbolic');
                        expect(detail.badgeNumber).toBe(3);
                        expect(detail.needsAttention).toBe(true);
                        // An omitted title settles on the NAME, because `add_titled`
                        // received it — the same answer `resolvePageTitle` gives.
                        const home = stack.get_page(stack.get_child_by_name('home') as Gtk.Widget);
                        expect(home.title).toBe('Home');
                    },
                );
            });

            await it('never reports a visible-child name no page carries', async () => {
                // THE AUTO-PICK NOTIFY ARRIVES BEFORE THE REF DOES. libadwaita selects the
                // first visible page from inside `adw_view_stack_add_titled`, and child
                // insertion sits OUTSIDE gtk-host's host-write window, so the handler runs
                // — while React has not yet committed the `ref` it would read the name
                // off. Measured before `visibleChildNotifier`: `['']`, a name no page has,
                // on a callback whose contract is to name the page that is showing.
                //
                // AND A CHANGE THE CALLER MADE REPORTS NOTHING HERE, which the second
                // `rerender` pins: gtk-host drops the notify raised inside its own
                // property write. That is a real divergence from the React Native half,
                // which re-applies the prop through `selectName` and reports what it
                // settled on — the README names it, and this row is what makes it a
                // measurement rather than a claim. A change the USER made reaches both;
                // driving a real switcher press is not something this suite can do.
                const seen: string[] = [];
                const pages = [
                    { name: 'home', title: 'Home', child: <gtk-label label="home" /> },
                    { name: 'detail', title: 'Detail', child: <gtk-label label="detail" /> },
                ];
                laidOut(
                    <AdwViewStack pages={pages} onNotifyVisibleChild={(name) => seen.push(name)} />,
                    (container, _window, rerender) => {
                        const stack = find(container, 'AdwViewStack') as Adw.ViewStack;
                        expect(stack.visibleChildName).toBe('home');
                        expect(seen).toStrictEqual([]);
                        rerender(
                            <AdwViewStack
                                pages={pages}
                                visibleChildName="detail"
                                onNotifyVisibleChild={(name) => seen.push(name)}
                            />,
                        );
                        expect(stack.visibleChildName).toBe('detail');
                        expect(seen).toStrictEqual([]);
                    },
                );
            });

            await it('points a real Adw.ViewSwitcher at the real Adw.ViewStack it built', async () => {
                laidOut(
                    <AdwViewSwitcher
                        policy="wide"
                        pages={[
                            { name: 'home', title: 'Home', child: <gtk-label label="home" /> },
                            { name: 'detail', title: 'Detail', child: <gtk-label label="detail" /> },
                        ]}
                    />,
                    (container) => {
                        const switcher = find(container, 'AdwViewSwitcher') as Adw.ViewSwitcher;
                        const stack = find(container, 'AdwViewStack') as Adw.ViewStack;
                        // THE BINDING, not merely both widgets existing: a switcher whose
                        // `stack` stayed null renders an empty row at exit 0, which is
                        // this host's whole failure signature.
                        expect(switcher.get_stack()).toBe(stack);
                        expect(switcher.policy).toBe(Adw.ViewSwitcherPolicy.WIDE);
                        expect(stack.visibleChildName).toBe('home');
                    },
                );
            });
        });

        await gated('the stack machine both halves answer alike', async () => {
            // Every assertion here has a twin in `navigation-view.native.spec.tsx`, run
            // against `NavigationViewState` instead of against libadwaita. The tags and
            // the tooltip are the whole cross-renderer claim: `push_by_tag` /
            // `pop_to_tag` / `replace_with_tags` are string-addressed on both halves, and
            // the back-button rule is `get_previous_page(visible) !== null &&
            // visible.can_pop` in both places.
            const withHandle = (
                body: (handle: AdwNavigationViewHandle) => void,
                options: { detailCanPop?: boolean } = {},
            ): void => {
                const ref: { current: AdwNavigationViewHandle | null } = { current: null };
                laidOut(
                    <AdwNavigationView animateTransitions={false} ref={ref}>
                        <AdwNavigationPage title="Home" tag="home">
                            <gtk-label label="home" />
                        </AdwNavigationPage>
                        <AdwNavigationPage title="Detail" tag="detail" canPop={options.detailCanPop}>
                            <gtk-label label="detail" />
                        </AdwNavigationPage>
                        <AdwNavigationPage title="Settings" tag="settings">
                            <gtk-label label="settings" />
                        </AdwNavigationPage>
                    </AdwNavigationView>,
                    () => {
                        if (ref.current === null) throw new Error('the view exposed no handle');
                        body(ref.current);
                    },
                );
            };

            await it('starts on the root page, with no way back', async () => {
                withHandle((handle) => {
                    expect(handle.visiblePageTag()).toBe('home');
                    expect(handle.canGoBack()).toBe(false);
                    expect(handle.backButtonTooltip()).toBe(null);
                });
            });

            await it('pushes by tag and names the revealed page in the tooltip', async () => {
                withHandle((handle) => {
                    handle.push('detail');
                    expect(handle.visiblePageTag()).toBe('detail');
                    expect(handle.canGoBack()).toBe(true);
                    // The tooltip is the title of the page the button would REVEAL, not
                    // of the one on screen.
                    expect(handle.backButtonTooltip()).toBe('Home');
                });
            });

            // THE `'Back'` FALLBACK IS ASSERTED ON THE REACT NATIVE HALF ONLY, and that is a
            // measurement rather than an omission. It needs a page whose title is EMPTY,
            // and libadwaita 1.9.3 prints `AdwNavigationPage 0x… is missing a title. To
            // hide a header bar title, consider using AdwHeaderBar:show-title instead.`
            // for exactly that page — a diagnostic `installDiagnosticsGate` fails on, and
            // correctly: this suite's whole premise is that GTK's failure mode is exit 0.
            // `navigation-view.native.spec.tsx` asserts the fallback against
            // `BACK_BUTTON_FALLBACK_TOOLTIP`, the constant `navigation-view.gtk.tsx`
            // imports from the same module, so the two halves still share the string.

            await it('pops back to the root and refuses to pop the root', async () => {
                withHandle((handle) => {
                    handle.push('detail');
                    expect(handle.pop()).toBe(true);
                    expect(handle.visiblePageTag()).toBe('home');
                    expect(handle.pop()).toBe(false);
                });
            });

            await it('replaces the whole stack, last tag visible', async () => {
                withHandle((handle) => {
                    handle.replaceWithTags(['home', 'detail', 'settings']);
                    expect(handle.visiblePageTag()).toBe('settings');
                    expect(handle.popToTag('home')).toBe(true);
                    expect(handle.visiblePageTag()).toBe('home');
                });
            });

            await it('hides the back button for a page that cannot be popped', async () => {
                withHandle(
                    (handle) => {
                        handle.push('detail');
                        expect(handle.visiblePageTag()).toBe('detail');
                        // `can-pop` gates the BUTTON and the shortcuts, never `pop()` —
                        // libadwaita's own split, and the core's.
                        expect(handle.canGoBack()).toBe(false);
                        expect(handle.backButtonTooltip()).toBe(null);
                        expect(handle.pop()).toBe(true);
                    },
                    { detailCanPop: false },
                );
            });
        });

        await gated('the ordering table both halves answer alike', async () => {
            // The twin of `navigation-split-view.native.spec.tsx`'s describe of the same
            // subject, which reads the pane NAME off `resolveNavigationStack`. Until this
            // one existed, the ordering table — the thing that makes a collapsed split
            // view a navigation stack rather than an `if (showContent)` — was asserted
            // against the CORE on one half and against nothing on the other, so
            // "libadwaita answers the same" was a claim.
            //
            // The visible page is read off the internal `AdwNavigationView`. There is no
            // getter for it, and `show-content` alone would not do: for the lone-child row
            // the property STAYS true (`set_show_content` takes its early return when
            // either pane is missing) while the sidebar is what is on screen, which is
            // precisely the case a flag-keyed renderer gets wrong.
            const visibleTag = (view: Gtk.Widget): string | null =>
                (find(view, 'AdwNavigationView') as Adw.NavigationView).get_visible_page()?.tag ?? null;

            const collapsed = (showContent: boolean, lone: boolean, body: (view: Gtk.Widget) => void): void =>
                laidOut(
                    <AdwNavigationSplitView
                        sidebar={<gtk-label label="sidebar" />}
                        sidebarTag="sidebar"
                        sidebarTitle="Sidebar"
                        contentTag="content"
                        contentTitle="Content"
                        collapsed={true}
                        showContent={showContent}
                    >
                        {lone ? undefined : <gtk-label label="content" />}
                    </AdwNavigationSplitView>,
                    (container) => body(find(container, 'AdwNavigationSplitView')),
                );

            await it('shows the SIDEBAR when collapsed and show-content is false', async () => {
                collapsed(false, false, (view) => expect(visibleTag(view)).toBe('sidebar'));
            });

            await it('shows the CONTENT when collapsed and show-content is true', async () => {
                collapsed(true, false, (view) => expect(visibleTag(view)).toBe('content'));
            });

            await it('keeps a LONE child visible whatever show-content says', async () => {
                collapsed(true, true, (view) => {
                    // The property the caller authored is still true …
                    expect((view as Adw.NavigationSplitView).showContent).toBe(true);
                    // … and the sidebar is the page on screen anyway.
                    expect(visibleTag(view)).toBe('sidebar');
                });
            });
        });

        if (display !== null) {
            await gated('the allocation, not only the setter', async () => {
                await it('splits a 1000-point frame 250 / 750, as the core does', async () => {
                    laidOut(
                        <AdwNavigationSplitView
                            sidebar={<gtk-label label="sidebar" />}
                            sidebarTitle="Sidebar"
                            contentTitle="Content"
                            sidebarWidthUnit="px"
                        >
                            <gtk-label label="content" hexpand={true} />
                        </AdwNavigationSplitView>,
                        (container) => {
                            const view = find(container, 'AdwNavigationSplitView');
                            const evidence = shotEvidence(view, capture);
                            expect(blankReason(evidence)).toBe(null);
                            expect(view.get_width()).toBe(FRAME_WIDTH);
                            // The same pair `navigation-split-view.native.spec.tsx`
                            // asserts as two style objects.
                            expect(allocatedWidth((view as Adw.NavigationSplitView).sidebar as Gtk.Widget, view)).toBe(
                                250,
                            );
                            expect(allocatedWidth((view as Adw.NavigationSplitView).content as Gtk.Widget, view)).toBe(
                                750,
                            );
                        },
                    );
                });

                await it('gives a COLLAPSED overlay sidebar 280 on a 360-point phone', async () => {
                    laidOut(
                        <AdwOverlaySplitView
                            sidebar={<gtk-label label="sidebar" />}
                            collapsed={true}
                            pinSidebar={true}
                            sidebarWidthUnit="px"
                        >
                            <gtk-label label="content" hexpand={true} />
                        </AdwOverlaySplitView>,
                        (container) => {
                            const view = find(container, 'AdwOverlaySplitView') as Adw.OverlaySplitView;
                            const evidence = shotEvidence(view, capture);
                            expect(blankReason(evidence)).toBe(null);
                            expect(view.get_width()).toBe(PHONE_FRAME_WIDTH);
                            // 280, not 90: a collapsed overlay IGNORES the fraction and
                            // clamps the VIEW width instead. The React Native suite
                            // asserts the same number off `resolveOverlaySidebarWidth`.
                            expect(allocatedWidth(view.sidebar as Gtk.Widget, view)).toBe(280);
                        },
                        { frameWidth: PHONE_FRAME_WIDTH },
                    );
                });

                await it('splits an UNCOLLAPSED overlay 250 / 750 in the same 1000-point frame', async () => {
                    laidOut(
                        <AdwOverlaySplitView sidebar={<gtk-label label="sidebar" />} sidebarWidthUnit="px">
                            <gtk-label label="content" hexpand={true} />
                        </AdwOverlaySplitView>,
                        (container) => {
                            const view = find(container, 'AdwOverlaySplitView') as Adw.OverlaySplitView;
                            expect(allocatedWidth(view.sidebar as Gtk.Widget, view)).toBe(250);
                            expect(allocatedWidth(view.content as Gtk.Widget, view)).toBe(750);
                        },
                    );
                });
            });

            await gated('the container minimum and the overlay cap, both the core\u2019s', async () => {
                // WHAT THIS DESCRIBE REPLACED, AND HOW MUCH OF IT COULD NOT BE WRITTEN.
                // `resolveNavigationSidebarWidth` and `resolveOverlaySidebarWidth` are
                // genuinely different rules — the first caps the sidebar's MAX BOUND by
                // `width - content_min`, the second caps the RESULT — and the core's own
                // header names a 300-point vector where they answer 180 and 100. The PAIR
                // is unreachable through GTK windows, measured, but only because of the
                // NAVIGATION half: `measure_uncollapsed` reports `sidebar_min +
                // content_min`, GTK never allocates below a widget's minimum, and from
                // that minimum upwards `width - content_min` never falls under
                // `sidebar_min`, so the bound cap never inverts. The 300-point frame in
                // the first row below is allocated 380. Asserting the two answers side by
                // side would therefore mean asserting a number one of the widgets cannot
                // produce; the disagreement itself is held by `@gjsify/adwaita-core`'s own
                // vectors and by its `the two widgets disagree on the SAME input`.
                //
                // THE OVERLAY'S OWN ANSWER IS NOT UNREACHABLE, and the second row is it.
                // Its minimum is `(int) (sidebar_min * show_progress) + content_min`
                // (adw-overlay-split-view.c), so a HIDDEN sidebar takes the whole
                // `sidebar_min` term out and 300 points is a width GTK will give it —
                // measured on libadwaita 1.9.3, no diagnostic, the sidebar allocated 100.
                // Without that row the result-cap, which is one of the two documented
                // differences between the widgets, had no GTK-side measurement at all:
                // both other overlay rows sit where the two rules agree.
                //
                // The MINIMUM is the same arithmetic on the other side:
                // `measureSplitViewHorizontal` computes it and the first row reads GTK's
                // answer back. The React Native half cannot be asked — a component there
                // is handed an already-laid-out size and never reports a minimum upwards,
                // which is the `childMin` divergence `AdwClamp` already carries.
                await it('refuses to be narrower than sidebar minimum plus content minimum', async () => {
                    const bounds = resolveSidebarBounds({ sidebarWidthUnit: 'px' }, 0);
                    const measured = measureSplitViewHorizontal({
                        bounds,
                        sidebarNatural: bounds.max,
                        contentMin: CONTENT_MINIMUM,
                        contentNatural: CONTENT_MINIMUM,
                    });
                    // 180 + 200. Written as the core's own call rather than as `380`, so a
                    // change to either default falls here instead of drifting.
                    expect(measured.minimum).toBe(380);

                    laidOut(
                        <AdwNavigationSplitView
                            sidebar={<gtk-label label="s" />}
                            sidebarTitle="Sidebar"
                            contentTitle="Content"
                            sidebarWidthUnit="px"
                        >
                            <gtk-label label="c" width-request={CONTENT_MINIMUM} />
                        </AdwNavigationSplitView>,
                        (container) => {
                            const view = find(container, 'AdwNavigationSplitView') as Adw.NavigationSplitView;
                            // The window asked for 300 and GTK gave the widget its own
                            // minimum instead — which is the number the core computes.
                            expect(view.get_width()).toBe(measured.minimum);
                            // And at that width both rules answer 180, the lower bound.
                            expect(allocatedWidth(view.sidebar as Gtk.Widget, view)).toBe(bounds.min);
                        },
                        { frameWidth: SQUEEZED_FRAME_WIDTH },
                    );
                });

                await it('caps the OVERLAY sidebar by the content minimum, where its sibling caps the bound', async () => {
                    // 100, and the navigation widget answers 180 for the same input —
                    // see the head of this describe for which half of that pair a GTK
                    // window can be asked about and why. Written as the core's own call
                    // AND as the literal, so a changed default falls here rather than
                    // letting both sides move together.
                    const capped = resolveOverlaySidebarWidth({
                        totalWidth: SQUEEZED_FRAME_WIDTH,
                        contentMin: CONTENT_MINIMUM,
                        sidebarWidthUnit: 'px',
                    });
                    expect(capped).toBe(100);

                    laidOut(
                        // `show-sidebar: false` is what takes the view's minimum down to
                        // the content's own; the sidebar is still ALLOCATED, off the
                        // leading edge, which is what makes the width readable.
                        <AdwOverlaySplitView
                            sidebar={<gtk-label label="s" />}
                            showSidebar={false}
                            sidebarWidthUnit="px"
                        >
                            <gtk-label label="c" width-request={CONTENT_MINIMUM} />
                        </AdwOverlaySplitView>,
                        (container) => {
                            const view = find(container, 'AdwOverlaySplitView') as Adw.OverlaySplitView;
                            expect(view.get_width()).toBe(SQUEEZED_FRAME_WIDTH);
                            expect(allocatedWidth(view.sidebar as Gtk.Widget, view)).toBe(capped);
                        },
                        { frameWidth: SQUEEZED_FRAME_WIDTH },
                    );
                });
            });
        }
    });
};
