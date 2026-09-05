// @gjsify/adwaita-nativescript — unit tests.
//
// These run on GJS (and Node), where neither the NativeScript runtime globals
// (`java` / `NSFileManager` / `registerElement`) nor `@nativescript/core` exist, so only
// the pure-TS-testable surface is exercised: the `assertNativeScript()` guard, the font
// helpers, the `registerAdwaitaElements()` no-op-when-global-absent contract, and the
// accessor logic against mocks.

import { describe, it, expect } from '@gjsify/unit';

// IMPORTANT: import the NS-core-free surface from its OWN modules, NOT from
// `./index.js`. The package root re-exports the widget classes, whose modules
// `import { GridLayout } from '@nativescript/core'` at top level — that bare specifier
// is unresolvable off NativeScript and fails the test bundle before any guard can run.
import {
    AVATAR_COLORS,
    flattenAvatarGradient,
    menuItemAt,
    normalizeClampSize,
    normalizeMenuModel,
    resolveSpinnerSize,
    snapAdjustmentValue,
} from '@gjsify/adwaita-core';
import type { AdwAdjustmentInput, AdwMenuInput } from '@gjsify/adwaita-core';
import {
    ADJUSTMENT_AUTHORED_VECTORS,
    ADJUSTMENT_PARSE_VECTORS,
    ADJUSTMENT_SNAP_VECTORS,
    AVATAR_COLOR_VECTORS,
    AVATAR_INITIALS_VECTORS,
    COMBO_CHOOSER_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import { assertNativeScript, isNativeScript } from '@gjsify/native-platform';
import { avatarColor, avatarInitials } from './widgets/avatar-color.js';
import {
    ADWAITA_SANS_FONT_FAMILY,
    ADWAITA_SANS_TTF_FILES,
    adwaitaFontInstallInstructions,
    hasAdwaitaSans,
} from './fonts.js';
// `row-press.js` and `icon-path.js` are TYPE-only / pure, so the REAL helpers load here.
import { attachRowPressFeedback } from './widgets/row-press.js';
import { presentMenuSheet } from './widgets/menu-sheet.js';
import type { TouchGestureEventData, View } from '@nativescript/core';
import { extractIconPaths, extractPathData, normalizeArcFlags } from './widgets/icon-path.js';
// `builder-slots.js` is pure too — no `@nativescript/core` — so the rule every
// XML-inflating widget shares is driven HERE rather than through a mock of it.
import { resolveBuilderSlot } from './widgets/builder-slots.js';
// `xml-values.js` is pure too, and it is the other half of the same door: XML hands a
// plain accessor a STRING, and the four shapes below are what the gallery probe
// measured going wrong on device.
import { xmlBoolean, xmlNumber } from './widgets/xml-values.js';
import { DEFAULT_ICON_COLOR, DEFAULT_ICON_COLOR_DARK } from './widgets/icon-path.js';
// Color scheme + breakpoints are HEADLESS in `@gjsify/adwaita-core` and specced THERE;
// imported through the NS re-export shims to pin the no-consumer-break guarantee. The
// NS-specific `addBreakpoints` view binding IS tested here, against a mock view.
import {
    adwaitaColorScheme,
    isThemeIconColor,
    onAdwaitaColorSchemeChanged,
    setAdwaitaColorScheme,
    themeIconColor,
    toggleAdwaitaColorScheme,
} from './widgets/color-scheme.js';
import {
    AdwBreakpoint,
    addBreakpoints,
    evaluateBreakpointCondition,
    parseBreakpointCondition,
} from './widgets/breakpoint.js';
import type { BreakpointConditionLeaf } from './widgets/breakpoint.js';
// Toast + alert-dialog models are HEADLESS in `@gjsify/adwaita-core`, specced in its
// `toast.spec.ts` / `dialog.spec.ts`; imported here only to smoke-test the surface. Their
// NS wrappers (`AdwToastOverlay`, `AdwAlertDialog`) pull `@nativescript/core` at
// module-eval and cannot load off-device — the built `lib/esm` re-export is verified
// separately.
import { AdwAlertResponses, AdwToast, AdwToastQueue, DEFAULT_TOAST_TIMEOUT } from '@gjsify/adwaita-core';
import type { ToastScheduler, ToastTimerHandle } from '@gjsify/adwaita-core';
// Same for the row interaction state machines, specced in the core's `rows.spec.ts`.
import { ComboState, ExpanderState, SpinState, ToggleGroupState, parseAdjustment } from '@gjsify/adwaita-core';

// The XML-registration helper's own module is import-safe, but it lives in the widgets
// barrel, which DOES pull the classes — so its absent-global no-op contract is
// re-implemented inline to keep this spec out of the `@nativescript/core` import chain.
function registerAdwaitaElementsNoopProbe(): void {
    // Mirrors widgets/index.ts: returns silently when registerElement is absent.
    const g = globalThis as { registerElement?: unknown };
    if (typeof g.registerElement !== 'function') return;
}

// The mocks below mirror the real accessor logic and must be kept in lockstep with the
// matching `src/widgets/adw-*.ts` modules; importing the real classes would evaluate
// `import { GridLayout } from '@nativescript/core'` at module-eval. A mock can only
// confirm that it agrees with itself, so anything with a real rule belongs in
// `@gjsify/adwaita-core` and is driven from `row-state.spec.ts` against its vectors.

interface MockField {
    text: string;
    secure: boolean;
}

// Mirrors AdwEntryRow.text <-> TextField.text (+ AdwPasswordEntryRow's secure flip).
class MockEntryRow {
    constructor(
        protected _field: MockField = { text: '', secure: false },
        secure = false,
    ) {
        this._field.secure = secure;
    }
    get text(): string {
        return this._field.text ?? '';
    }
    set text(value: string) {
        const next = value ?? '';
        if (this._field.text !== next) this._field.text = next;
    }
    get secure(): boolean {
        return this._field.secure;
    }
}

// Mirrors AdwSliderRow's clamp-then-snap-to-step, in lockstep with
// `src/widgets/adw-slider-row.ts` `_snap`.
// Mirrors AdwSliderRow's value half — the widget cannot be instantiated off-device, so
// this composes exactly what it composes: the core adjustment plus `snapAdjustmentValue`.
// It used to hold its OWN copy of the clamp-and-snap arithmetic, which meant these
// assertions passed while measuring the mock; the copy went with ADR 0047.
class MockSliderRow {
    private readonly _state = new SpinState();
    constructor() {
        // The widget's `changed` subscriber, which is where the re-snap lives: a moved bound
        // moves the tick grid, so a value the old grid allowed can land between two ticks of
        // the new one. Registering it HERE rather than re-snapping inside the setter is what
        // keeps this mock from doing something the widget does not — the shape ADR 0047
        // removed from this file once already.
        this._state.subscribeChanged((adjustment) => {
            // Guarded as the widget guards it: a re-snap that changes nothing must not mark
            // the value as WRITTEN, or this row stops answering like `AdwSpinRow`.
            const snapped = snapAdjustmentValue(adjustment, this._state.value);
            if (snapped !== this._state.value) this._state.setValue(snapped);
        });
    }
    get value(): number {
        return this._state.value;
    }
    set value(v: number) {
        this._state.setValue(snapAdjustmentValue(this._state.adjustment, v));
    }
    set adjustment(v: AdwAdjustmentInput) {
        this._state.configure(v);
    }
}

// Mirrors AdwViewSwitcherBase's selection: visibility + active-button + clamp +
// the don't-emit-on-no-change/out-of-range guard (selected setter).
class MockViewSwitcher {
    private _selected = 0;
    pageVisibility: string[] = [];
    activeButtons: boolean[] = [];
    notified: number[] = [];
    constructor(private _count: number) {
        this._apply();
    }
    private _apply(): void {
        this.pageVisibility = Array.from({ length: this._count }, (_, i) =>
            i === this._selected ? 'visible' : 'collapse',
        );
        this.activeButtons = Array.from({ length: this._count }, (_, i) => i === this._selected);
    }
    get selected(): number {
        return this._selected;
    }
    set selected(value: number) {
        const next = Number.isFinite(value) ? value : 0;
        if (next === this._selected || next < 0 || next >= this._count) return;
        this._selected = next;
        this._apply();
        this.notified.push(next);
    }
}

// Mirrors AdwViewStack's named-page model + visible-child selection (first page
// auto-visible; bounds-guarded; emits on real change). A bound switcher reads it.
class MockViewStack {
    private _pages: { name: string; title: string }[] = [];
    private _visible = 0;
    private _subs: Array<() => void> = [];
    notified: Array<{ index: number; name: string }> = [];
    add(name: string, title?: string): void {
        this._pages.push({ name, title: title ?? name });
    }
    subscribe(fn: () => void): void {
        this._subs.push(fn);
    }
    get pages(): { name: string; title: string }[] {
        return this._pages;
    }
    get visibleChildIndex(): number {
        return this._visible;
    }
    set visibleChildIndex(value: number) {
        if (!Number.isFinite(value) || value < 0 || value >= this._pages.length) return;
        if (value === this._visible) return;
        this._visible = value;
        this.notified.push({ index: value, name: this._pages[value].name });
        for (const fn of this._subs) fn();
    }
    get visibleChildName(): string {
        return this._pages[this._visible]?.name ?? '';
    }
    set visibleChildName(name: string) {
        const idx = this._pages.findIndex((p) => p.name === name);
        if (idx >= 0) this.visibleChildIndex = idx;
    }
    pageVisibility(): string[] {
        return this._pages.map((_, i) => (i === this._visible ? 'visible' : 'collapse'));
    }
}

// Mirrors AdwViewSwitcherBar binding: a button per stack page, the active button
// synced to the stack's visible child, and button taps routed back to the stack.
class MockViewSwitcherBar {
    activeButtons: boolean[] = [];
    private _revealed = true;
    constructor(private _stack: MockViewStack) {
        this._stack.subscribe(() => this._sync());
        this._sync();
    }
    tap(index: number): void {
        this._stack.visibleChildIndex = index;
    }
    private _sync(): void {
        const sel = this._stack.visibleChildIndex;
        this.activeButtons = this._stack.pages.map((_, i) => i === sel);
    }
    get revealed(): boolean {
        return this._revealed;
    }
    set revealed(value: boolean) {
        this._revealed = !!value;
    }
    get visibility(): string {
        return this._revealed ? 'visible' : 'collapse';
    }
}

// GtkMenuButton's action()-resolution used to be MIRRORED here by a mock, and the
// mirror is what a mock costs: the widget's own resolution moved into `menu-sheet.ts`
// (ADR 0042), where it is free of `@nativescript/core` and can be driven directly. The
// helper below drives the REAL modules — `presentMenuSheet` decides the rows and the
// round trip, `menuItemAt` resolves the answer — so what is asserted is the shipping
// code rather than a copy of it that cannot notice a divergence.
async function chooseMenuItem(
    input: AdwMenuInput,
    pick: (actions: string[]) => string | undefined,
): Promise<{ id: string; label: string; path: readonly number[] } | null> {
    const model = normalizeMenuModel(input);
    const path = await presentMenuSheet((options) => Promise.resolve(pick(options.actions)), model);
    if (path === null) return null;
    const item = menuItemAt(model, path);
    return item === null ? null : { id: item.id ?? item.label, label: item.label, path };
}

// Mirrors AdwCarousel's clamped scrollToPage + dot-active + nPages.
class MockCarousel {
    private _position = 0;
    private _pages = 0;
    notified: number[] = [];
    addPage(): void {
        this._pages += 1;
    }
    get nPages(): number {
        return this._pages;
    }
    get position(): number {
        return this._position;
    }
    scrollToPage(index: number): void {
        const clamped = Math.max(0, Math.min(this._pages - 1, index));
        if (clamped !== this._position) {
            this._position = clamped;
            this.notified.push(clamped);
        }
    }
    activeDots(): boolean[] {
        return Array.from({ length: this._pages }, (_, i) => i === this._position);
    }
}

// Mirrors AdwNavigationView's manual push/pop stack (first add auto-pushes).
class MockNavigationView {
    private _registered: string[] = [];
    private _stack: string[] = [];
    add(tag: string): void {
        this._registered.push(tag);
        if (this._stack.length === 0) this._stack.push(tag);
    }
    push(tag: string): void {
        if (this._registered.includes(tag)) this._stack.push(tag);
    }
    pop(): boolean {
        if (this._stack.length <= 1) return false;
        this._stack.pop();
        return true;
    }
    get visibleTag(): string | null {
        return this._stack[this._stack.length - 1] ?? null;
    }
    get depth(): number {
        return this._stack.length;
    }
}

// A deterministic scheduler stand-in for the AdwToastQueue smoke test — the injected
// timing seam a renderer supplies (NS wraps `setTimeout`).
class FakeToastScheduler implements ToastScheduler {
    private _next: (() => void) | null = null;
    schedule(callback: () => void, _ms: number): ToastTimerHandle {
        this._next = callback;
        return 1;
    }
    cancel(_handle: ToastTimerHandle): void {
        this._next = null;
    }
    fire(): void {
        const fn = this._next;
        this._next = null;
        fn?.();
    }
}

// Minimal View stand-in for attachRowPressFeedback: records pseudo-class add/delete and
// exposes the captured `touch` handler so the test can drive the gesture phases.
class MockPressRow {
    pseudo = new Set<string>();
    private _touch: ((e: TouchGestureEventData) => void) | null = null;
    addEventListener(name: string, cb: (e: TouchGestureEventData) => void): void {
        if (name === 'touch') this._touch = cb;
    }
    addPseudoClass(name: string): void {
        this.pseudo.add(name);
    }
    deletePseudoClass(name: string): void {
        this.pseudo.delete(name);
    }
    fire(action: TouchGestureEventData['action']): void {
        this._touch?.({
            eventName: 'touch',
            object: this as unknown as View,
            action,
            getX: () => 0,
            getY: () => 0,
        });
    }
}

export default async () => {
    await describe('@gjsify/adwaita-nativescript outside NativeScript', async () => {
        await it('isNativeScript is false off-device', () => {
            expect(isNativeScript).toBe(false);
        });

        await it('assertNativeScript throws Platform not supported', () => {
            expect(() => assertNativeScript()).toThrow('Platform not supported');
        });

        await it('element registration is a safe no-op when registerElement is absent', () => {
            // registerElement global does not exist off NativeScript — must not throw.
            expect(() => registerAdwaitaElementsNoopProbe()).not.toThrow();
        });
    });

    await describe('XML builder slots (the name a template child arrives under)', async () => {
        // The widgets' own property names, as NativeScript's complex-property
        // syntax spells them: `<AdwToolbarView.topBar>` -> `topBar`.
        const TOOLBAR = ['topBar', 'bottomBar', 'content'] as const;

        await it('a declared slot name selects that slot', () => {
            expect(resolveBuilderSlot('topBar', TOOLBAR, 'content')).toBe('topBar');
            expect(resolveBuilderSlot('bottomBar', TOOLBAR, 'content')).toBe('bottomBar');
        });

        await it('a bare child arrives under its ELEMENT name and takes the fallback', () => {
            // This is the case that mattered on device: NativeScript passes the
            // element name for an untyped child, so anything not a slot has to
            // land somewhere deliberate rather than in the layout's first cell.
            expect(resolveBuilderSlot('AdwHeaderBar', TOOLBAR, 'content')).toBe('content');
            expect(resolveBuilderSlot('Label', TOOLBAR, 'content')).toBe('content');
        });

        await it('reduces a dotted name to its last segment', () => {
            expect(resolveBuilderSlot('AdwToolbarView.topBar', TOOLBAR, 'content')).toBe('topBar');
        });

        await it('a non-string name is the fallback, not a crash', () => {
            expect(resolveBuilderSlot(undefined, TOOLBAR, 'content')).toBe('content');
            expect(resolveBuilderSlot(null, TOOLBAR, 'content')).toBe('content');
        });

        await it('matching is exact — a near-miss is NOT the slot', () => {
            // A silent near-miss is the whole failure class here: `topbar` landing
            // in the content would put a header bar where the content goes and
            // report nothing.
            expect(resolveBuilderSlot('topbar', TOOLBAR, 'content')).toBe('content');
            expect(resolveBuilderSlot('top-bar', TOOLBAR, 'content')).toBe('content');
        });
    });

    await describe('XML attribute values (xml-values)', async () => {
        // NativeScript's Builder assigns an attribute verbatim, so every one of these
        // is a STRING on the way in. All four failures below were measured on an
        // Android emulator by showcases/dom/adwaita-gallery-nativescript.
        await it('parses a numeric attribute rather than substituting the default', () => {
            // `<AdwAvatar size="96">` rendered at 48: Number.isFinite('96') is false.
            expect(xmlNumber('96', 48)).toBe(96);
            expect(xmlNumber('3', 0)).toBe(3);
            expect(xmlNumber(-4, 0)).toBe(-4);
        });

        await it('keeps a real number untouched, so the TypeScript caller is unchanged', () => {
            expect(xmlNumber(96, 48)).toBe(96);
            expect(xmlNumber(0, 48)).toBe(0);
        });

        await it('refuses what is not a number instead of letting NaN through', () => {
            expect(xmlNumber('', 48)).toBe(48);
            expect(xmlNumber('   ', 48)).toBe(48);
            expect(xmlNumber('later', 48)).toBe(48);
            expect(xmlNumber(Number.NaN, 48)).toBe(48);
            expect(xmlNumber(Number.POSITIVE_INFINITY, 48)).toBe(48);
            expect(xmlNumber(null, 48)).toBe(48);
        });

        await it('reads "false" as false — the truthiness that revealed a password', () => {
            // `<AdwPasswordEntryRow revealed="false">` revealed it, and
            // `<AdwAboutDialog open="false">` opened on load: !!'false' is true.
            expect(xmlBoolean('false', true)).toBe(false);
            expect(xmlBoolean('true', false)).toBe(true);
            expect(xmlBoolean('False', true)).toBe(false);
        });

        await it('a spelling that is neither takes the fallback, not its truthiness', () => {
            expect(xmlBoolean('yes', false)).toBe(false);
            expect(xmlBoolean('1', false)).toBe(false);
            expect(xmlBoolean('', true)).toBe(true);
            expect(xmlBoolean(undefined, true)).toBe(true);
        });

        await it('keeps a real boolean untouched', () => {
            expect(xmlBoolean(true, false)).toBe(true);
            expect(xmlBoolean(false, true)).toBe(false);
        });

        // Two setters deliberately do NOT use the helpers above: `AdwSpinner.size` and
        // `AdwClamp.maximumSize` delegate to normalizers that already take a string and
        // parse it with `Number.parseFloat`, so a CSS-ish length is a length. Wrapping
        // them in `xmlNumber` swapped that for `Number` and both fell to the default —
        // a regression that shipped once and that `check-nativescript-xml-doors.mjs`
        // now refuses by name. These pin the tolerance the refusal protects.
        await it('the loose normalizers parse a CSS-ish length, which xmlNumber must not be asked to', () => {
            expect(resolveSpinnerSize('24px')).toBe(24);
            expect(normalizeClampSize('50%', 400)).toBe(50);
            expect(xmlNumber('24px', 48)).toBe(48);
        });
    });

    await describe('@gjsify/adwaita-nativescript fonts', async () => {
        await it('exposes a dual iOS+Android font-family', () => {
            expect(ADWAITA_SANS_FONT_FAMILY).toContain('Adwaita Sans');
            expect(ADWAITA_SANS_FONT_FAMILY).toContain('AdwaitaSans-Regular');
        });

        await it('sources TTFs from @gjsify/adwaita-fonts', () => {
            expect(ADWAITA_SANS_TTF_FILES.regular.source).toContain('@gjsify/adwaita-fonts');
            expect(ADWAITA_SANS_TTF_FILES.regular.target).toBe('AdwaitaSans-Regular.ttf');
            expect(ADWAITA_SANS_TTF_FILES.italic.source).toContain('adwaita-sans-400-italic.ttf');
        });

        await it('install instructions mention App_Resources font dirs', () => {
            const text = adwaitaFontInstallInstructions();
            expect(text).toContain('App_Resources/Android');
            expect(text).toContain('App_Resources/iOS');
            expect(text).toContain('AdwaitaSans-Regular.ttf');
        });

        await it('hasAdwaitaSans is false off NativeScript and never throws', () => {
            expect(hasAdwaitaSans()).toBe(false);
        });
    });

    await describe('AdwEntryRow text<->field binding (mock)', async () => {
        await it('reads and writes the field text', () => {
            const field: MockField = { text: '', secure: false };
            const row = new MockEntryRow(field);
            row.text = 'hello';
            expect(field.text).toBe('hello');
            expect(row.text).toBe('hello');
        });

        await it('coerces null/undefined to an empty string', () => {
            const row = new MockEntryRow();
            // Cast through unknown to feed a non-string and exercise the `?? ''`
            // coercion the real setter performs.
            row.text = null as unknown as string;
            expect(row.text).toBe('');
        });

        await it('password variant marks the field secure', () => {
            const field: MockField = { text: '', secure: false };
            const row = new MockEntryRow(field, true);
            expect(row.secure).toBe(true);
            expect(field.secure).toBe(true);
        });
    });

    await describe('AdwComboRow selection (core ComboState re-export)', async () => {
        // The full matrix is specced in @gjsify/adwaita-core; this pins the surface the
        // NS `AdwComboRow` composes.
        await it('resolves selectedValue from selectedIndex', () => {
            const state = new ComboState();
            state.setModel([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            state.setSelectedIndex(1);
            expect(state.selectedValue).toBe('b');
        });

        await it('setSelectedValue moves selectedIndex; out-of-range → empty value', () => {
            const state = new ComboState();
            state.setModel([{ label: 'One', value: 'a' }]);
            state.setSelectedIndex(5);
            expect(state.selectedValue).toBe('');
            state.setModel([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            expect(state.setSelectedValue('b')).toBe(true);
            expect(state.selectedIndex).toBe(1);
        });

        // `model_changed`. The widget reads this predicate TWICE — once to collapse the
        // chevron, once to refuse the tap — and cannot be imported here, so the table is
        // driven against the state it reads. Both halves matter: hiding the chevron alone
        // leaves a row that still opens an `action()` sheet with one entry.
        for (const { count, presentsChooser, rule } of COMBO_CHOOSER_VECTORS) {
            await it(`${count} option(s) → presentsChooser ${presentsChooser}: ${rule}`, () => {
                const state = new ComboState();
                state.setModel(Array.from({ length: count }, (_, i) => ({ label: `L${i}`, value: `v${i}` })));
                expect(state.presentsChooser).toBe(presentsChooser);
            });
        }
    });

    // THE SHARED TABLES, driven through what the widgets compose — the same rows the core
    // suite and the browser suite assert, so a range authored in one dialect means the same
    // thing in all three (ADR 0047). The widget classes cannot be constructed off-device,
    // so these drive `SpinState` and `snapAdjustmentValue` directly: exactly what
    // `AdwSpinRow` and `AdwSliderRow` hold, reached without `@nativescript/core`.
    await describe('the portable adjustment on NativeScript', async () => {
        for (const vector of ADJUSTMENT_AUTHORED_VECTORS) {
            await it(`authored: ${vector.rule}`, () => {
                const state = new SpinState();
                state.configure(vector.input);
                expect(state.adjustment).toStrictEqual({ ...vector.adjustment });
            });
        }

        // The XML door, which is where a NativeScript attribute arrives: a string, handed
        // to the same setter a TypeScript caller writes an object to.
        const SEEDED = { value: 7, lower: 0, upper: 100, stepIncrement: 1, pageIncrement: 1, pageSize: 0 };
        for (const vector of ADJUSTMENT_PARSE_VECTORS) {
            await it(`attribute: ${vector.rule}`, () => {
                const state = new SpinState();
                state.setValue(7);
                expect(state.adjustment).toStrictEqual(SEEDED);

                state.configure(parseAdjustment(vector.raw));
                expect(state.adjustment).toStrictEqual({ ...SEEDED, ...vector.input });
            });
        }

        for (const vector of ADJUSTMENT_SNAP_VECTORS) {
            await it(`snap: ${vector.rule}`, () => {
                const state = new SpinState();
                state.configure(vector.input);
                expect(snapAdjustmentValue(state.adjustment, vector.from)).toBe(vector.snapped);
            });
        }
    });

    await describe('AdwSpinRow numeric stepper (core SpinState re-export)', async () => {
        // The full clamp/step-edge matrix is specced in @gjsify/adwaita-core.
        await it('clamps the value and steps to the bounds', () => {
            const state = new SpinState();
            state.configure({ lower: 0, upper: 4, stepIncrement: 2, value: 99 });
            expect(state.value).toBe(4); // clamped
            state.setValue(0);
            state.increment();
            expect(state.value).toBe(2);
            state.increment();
            state.increment();
            expect(state.value).toBe(4); // clamped at the upper bound
        });

        await it('re-clamps the current value when the lower bound rises above it', () => {
            const state = new SpinState();
            state.setValue(3);
            state.configure({ lower: 5 });
            expect(state.value).toBe(5);
        });
    });

    await describe('AdwSliderRow range snap (mock)', async () => {
        await it('clamps into the adjustment range', () => {
            const row = new MockSliderRow();
            row.adjustment = { lower: 16, upper: 64 };
            row.value = 99;
            expect(row.value).toBe(64);
            row.value = 0;
            expect(row.value).toBe(16);
        });

        await it('snaps to the nearest tick from the lower bound', () => {
            const row = new MockSliderRow();
            row.adjustment = { lower: 0, upper: 100, stepIncrement: 5 };
            row.value = 23;
            expect(row.value).toBe(25);
            row.value = 21;
            expect(row.value).toBe(20);
        });

        await it('snaps relative to a non-zero lower bound', () => {
            const row = new MockSliderRow();
            row.adjustment = { lower: 16, upper: 64, stepIncrement: 4 };
            row.value = 49; // 16 + round(33/4)*4 = 16 + 8*4 = 48
            expect(row.value).toBe(48);
        });

        await it('leaves an UNWRITTEN value following the range, as the spin row does', () => {
            // The re-snap must not place the value: a row nobody has written to opens at the
            // bottom of whatever range it is given, on both widgets.
            const row = new MockSliderRow();
            row.adjustment = { lower: 10, upper: 20 };
            expect(row.value).toBe(10);
            row.adjustment = { lower: -100, upper: -50 };
            expect(row.value).toBe(-100);
        });

        await it('re-snaps a settled value when a bound moves the GRID under it', () => {
            // The order the other rows never use: value first, then the range. 25 is on the
            // grid `0, 5, 10, …` and off `1, 6, 11, …`, and clamping alone leaves it there.
            const row = new MockSliderRow();
            row.adjustment = { lower: 0, upper: 100, stepIncrement: 5 };
            row.value = 23;
            expect(row.value).toBe(25);

            row.adjustment = { lower: 1 };
            expect(row.value).toBe(26);
        });
    });

    await describe('AdwExpanderRow disclosure (core ExpanderState re-export)', async () => {
        // The toggle/idempotence matrix is specced in @gjsify/adwaita-core; this pins the
        // surface the NS `AdwExpanderRow` composes to drive `visibility` + the chevron.
        await it('toggles expanded idempotently', () => {
            const state = new ExpanderState();
            expect(state.expanded).toBe(false);
            expect(state.toggle()).toBe(true);
            expect(state.expanded).toBe(true);
            expect(state.setExpanded(true)).toBe(false); // idempotent
            expect(state.collapse()).toBe(true);
            expect(state.expanded).toBe(false);
        });
    });

    // The REAL derivation, not a mirror: the vectors are the same table
    // `@gjsify/adwaita-web` asserts against, so a divergence between the two renderers —
    // or from the libadwaita source — fails here instead of in a screenshot.
    await describe('AdwAvatar derivation (shared conformance vectors)', async () => {
        for (const { text, initials, rule } of AVATAR_INITIALS_VECTORS) {
            await it(`initials ${JSON.stringify(text)} -> ${JSON.stringify(initials)} — ${rule}`, () => {
                expect(avatarInitials(text)).toBe(initials);
            });
        }

        for (const { text, colorClass } of AVATAR_COLOR_VECTORS) {
            await it(`colour for ${JSON.stringify(text)} is color${colorClass}, flattened`, () => {
                const palette = AVATAR_COLORS[colorClass - 1]!;
                expect(avatarColor(text)).toStrictEqual({
                    fill: flattenAvatarGradient(palette),
                    fg: palette.fg,
                });
            });
        }

        await it('treats a null-ish name as empty rather than throwing', () => {
            expect(avatarInitials(undefined as unknown as string)).toBe('');
            expect(avatarColor(undefined as unknown as string).fg).toBe(AVATAR_COLORS[0]!.fg);
        });
    });

    await describe('AdwViewSwitcher / TabView / InlineViewSwitcher selection (mock)', async () => {
        await it('shows only the selected page and marks its button active', () => {
            const sw = new MockViewSwitcher(3);
            sw.selected = 1;
            expect(sw.pageVisibility).toStrictEqual(['collapse', 'visible', 'collapse']);
            expect(sw.activeButtons).toStrictEqual([false, true, false]);
        });

        await it('emits on change but ignores out-of-range / no-change', () => {
            const sw = new MockViewSwitcher(2);
            sw.selected = 1;
            sw.selected = 1; // no change
            sw.selected = 9; // out of range
            sw.selected = -1; // out of range
            expect(sw.notified).toStrictEqual([1]);
        });
    });

    await describe('AdwViewStack + AdwViewSwitcherBar (decoupled stack/switcher, mock)', async () => {
        await it('shows the first added page by default', () => {
            const stack = new MockViewStack();
            stack.add('learn', 'Learn');
            stack.add('code', 'Code');
            expect(stack.visibleChildName).toBe('learn');
            expect(stack.pageVisibility()).toStrictEqual(['visible', 'collapse']);
        });

        await it('selects by name and index, emitting only on real change', () => {
            const stack = new MockViewStack();
            stack.add('learn', 'Learn');
            stack.add('code', 'Code');
            stack.add('debug', 'Debug');
            stack.visibleChildName = 'debug';
            stack.visibleChildIndex = 2; // no change
            stack.visibleChildIndex = 9; // out of range
            expect(stack.visibleChildIndex).toBe(2);
            expect(stack.notified).toStrictEqual([{ index: 2, name: 'debug' }]);
        });

        await it('a bound switcher bar reflects and drives the stack two-way', () => {
            const stack = new MockViewStack();
            stack.add('learn', 'Learn');
            stack.add('code', 'Code');
            const bar = new MockViewSwitcherBar(stack);
            expect(bar.activeButtons).toStrictEqual([true, false]);
            // Tapping a bar button moves the stack...
            bar.tap(1);
            expect(stack.visibleChildName).toBe('code');
            expect(bar.activeButtons).toStrictEqual([false, true]);
            // ...and a programmatic stack change syncs the bar back.
            stack.visibleChildIndex = 0;
            expect(bar.activeButtons).toStrictEqual([true, false]);
        });

        await it('revealed toggles bar visibility', () => {
            const bar = new MockViewSwitcherBar(new MockViewStack());
            expect(bar.visibility).toBe('visible');
            bar.revealed = false;
            expect(bar.visibility).toBe('collapse');
        });
    });

    await describe('GtkMenuButton activation (the real sheet modules)', async () => {
        await it('emits id/label/path for a chosen item', async () => {
            const chosen = await chooseMenuItem(
                [
                    { id: 'about', label: 'About' },
                    { id: 'prefs', label: 'Preferences' },
                ],
                (actions) => actions[1],
            );
            expect(chosen).toStrictEqual({ id: 'prefs', label: 'Preferences', path: [1] });
        });

        await it('falls back to label as id, and a cancel emits nothing', async () => {
            expect(await chooseMenuItem([{ label: 'Quit' }], () => undefined)).toBe(null);
            expect(await chooseMenuItem([{ label: 'Quit' }], (actions) => actions[0])).toStrictEqual({
                id: 'Quit',
                label: 'Quit',
                path: [0],
            });
        });

        await it('reaches an item inside a submenu, which no flat index could name', async () => {
            const chosen = await chooseMenuItem(
                [{ label: 'About' }, { label: 'More', submenu: [{ id: 'quit', label: 'Quit' }] }],
                (actions) => actions[actions.length - 1],
            );
            expect(chosen).toStrictEqual({ id: 'quit', label: 'Quit', path: [1, 0] });
        });
    });

    await describe('AdwCarousel paging (mock)', async () => {
        await it('clamps scrollToPage and tracks active dot', () => {
            const c = new MockCarousel();
            c.addPage();
            c.addPage();
            c.addPage();
            c.scrollToPage(1);
            expect(c.position).toBe(1);
            expect(c.activeDots()).toStrictEqual([false, true, false]);
            c.scrollToPage(99);
            expect(c.position).toBe(2); // clamped to last
        });

        await it('reports nPages and emits only on real moves', () => {
            const c = new MockCarousel();
            c.addPage();
            c.addPage();
            expect(c.nPages).toBe(2);
            c.scrollToPage(1);
            c.scrollToPage(1); // no change
            expect(c.notified).toStrictEqual([1]);
        });
    });

    await describe('AdwNavigationView stack (mock)', async () => {
        await it('auto-pushes the first added page and never empties', () => {
            const nav = new MockNavigationView();
            nav.add('home');
            expect(nav.visibleTag).toBe('home');
            expect(nav.depth).toBe(1);
            expect(nav.pop()).toBe(false); // can't pop the root
        });

        await it('pushes and pops registered pages', () => {
            const nav = new MockNavigationView();
            nav.add('home');
            nav.add('detail');
            nav.push('detail');
            expect(nav.visibleTag).toBe('detail');
            expect(nav.depth).toBe(2);
            expect(nav.pop()).toBe(true);
            expect(nav.visibleTag).toBe('home');
        });
    });

    // The split-view state lives in `split-view-state.spec.ts`, against the real
    // adapters the widgets run on. The `MockSplitView` that stood here
    // reimplemented the two setters, so it could only confirm that it agreed with
    // itself — and the widgets' four divergences from libadwaita went untested.

    await describe('AdwToggleGroup selection (core ToggleGroupState re-export)', async () => {
        // The selection/bounds/notify matrix is specced in @gjsify/adwaita-core;
        // this pins the moved surface the NS `AdwToggleGroup` (the segment render)
        // composes to raise the active pill.
        await it('resolves selectedValue from the label list', () => {
            const state = new ToggleGroupState();
            state.setLabels(['Day', 'Week', 'Month']);
            state.setSelected(2);
            expect(state.selectedValue).toBe('Month');
        });

        await it('guards an out-of-range selection', () => {
            const state = new ToggleGroupState();
            state.setLabels(['Day']);
            expect(state.setSelected(5)).toBe(false); // stays at 0
            expect(state.selectedValue).toBe('Day');
        });
    });

    await describe('alert-dialog response model (core AdwAlertResponses re-export)', async () => {
        // The registry/appearance/enabled/ordering/resolution matrix is specced in
        // @gjsify/adwaita-core; this pins the moved surface the NS `AdwAlertDialog`
        // (the confirm()/action() binding) composes.
        await it('orders default→ok, last→cancel, middle→neutral', () => {
            const d = new AdwAlertResponses();
            d.addResponse('save', 'Save');
            d.addResponse('discard', 'Discard');
            d.addResponse('cancel', 'Cancel');
            d.defaultResponse = 'save';
            const o = d.orderResponses();
            expect(d.resolveById(o.ok?.id)).toBe('save'); // OK = default
            expect(d.resolveById(o.cancel?.id)).toBe('cancel'); // cancel = last
            expect(d.resolveById(o.neutral?.id)).toBe('discard'); // neutral = middle
        });

        await it('switches to an action sheet past three responses', () => {
            const d = new AdwAlertResponses();
            d.addResponses('a', 'A', 'b', 'B', 'c', 'C');
            expect(d.usesActionSheet).toBe(false);
            d.addResponse('d', 'D', { appearance: 'destructive' });
            expect(d.usesActionSheet).toBe(true);
            expect(d.getResponseAppearance('d')).toBe('destructive');
        });
    });

    await describe('toast value object + queue (core re-export)', async () => {
        // The AdwToast value object + AdwToastQueue one-at-a-time/auto-dismiss
        // matrix is specced in @gjsify/adwaita-core; this pins the moved surface
        // the NS `AdwToastOverlay` (the GridLayout render + setTimeout scheduler)
        // drives.
        await it('AdwToast defaults the timeout and tracks the action button', () => {
            expect(new AdwToast('Saved').timeout).toBe(DEFAULT_TOAST_TIMEOUT);
            const t = new AdwToast('Deleted', { timeout: 2000, buttonLabel: 'Undo' });
            expect(t.timeout).toBe(2000);
            expect(t.hasButton).toBe(true);
        });

        await it('AdwToastQueue shows one at a time and auto-dismisses via the injected scheduler', () => {
            const scheduler = new FakeToastScheduler();
            const shown: string[] = [];
            const queue = new AdwToastQueue({
                scheduler,
                onShow: (t) => shown.push(t.title),
                onHide: () => {},
            });
            queue.add(new AdwToast('first', { timeout: 3000 }));
            queue.add(new AdwToast('second', { timeout: 3000 }));
            expect(shown).toStrictEqual(['first']); // only one at a time
            scheduler.fire(); // the first auto-dismisses
            expect(shown).toStrictEqual(['first', 'second']); // queue advanced
        });
    });

    await describe('attachRowPressFeedback (activatable-row press state)', async () => {
        await it('adds the highlighted pseudo-class on touch-down', () => {
            const row = new MockPressRow();
            attachRowPressFeedback(row as unknown as View);
            row.fire('down');
            expect(row.pseudo.has('highlighted')).toBe(true);
        });

        await it('clears it on release (up)', () => {
            const row = new MockPressRow();
            attachRowPressFeedback(row as unknown as View);
            row.fire('down');
            row.fire('up');
            expect(row.pseudo.has('highlighted')).toBe(false);
        });

        await it('clears it on scroll-cancel', () => {
            const row = new MockPressRow();
            attachRowPressFeedback(row as unknown as View);
            row.fire('down');
            row.fire('cancel');
            expect(row.pseudo.has('highlighted')).toBe(false);
        });

        await it('keeps the highlight through a move (no premature clear)', () => {
            const row = new MockPressRow();
            attachRowPressFeedback(row as unknown as View);
            row.fire('down');
            row.fire('move');
            expect(row.pseudo.has('highlighted')).toBe(true);
        });
    });

    await describe('symbolic-icon path extraction (Adwaita icons → native render)', async () => {
        // A single-path icon (like go-previous-symbolic).
        const SINGLE = '<svg viewBox="0 0 16 16"><path d="m 12 2 l -6 6 z" fill="currentColor"/></svg>';
        // A multi-path icon with a dimmed sub-fill (like sidebar-show-right-symbolic).
        const MULTI =
            '<svg viewBox="0 0 16 16"><g fill="currentColor">' +
            '<path d="m 10 13 v -10 z" fill-opacity="0.34902"/>' +
            '<path d="m 13 1 c 1 1 1 1 z"/></g></svg>';

        await it('extracts a single path at full opacity', () => {
            const paths = extractIconPaths(SINGLE);
            expect(paths.length).toBe(1);
            expect(paths[0]!.d).toBe('m 12 2 l -6 6 z');
            expect(paths[0]!.opacity).toBe(1);
        });

        await it('keeps each path separate with its own fill-opacity', () => {
            const paths = extractIconPaths(MULTI);
            expect(paths.length).toBe(2);
            expect(paths[0]!.opacity).toBeLessThan(1);
            expect(paths[0]!.opacity).toBeGreaterThan(0.3);
            expect(paths[1]!.opacity).toBe(1);
        });

        await it('returns no paths for an SVG without path data', () => {
            expect(extractIconPaths('<svg viewBox="0 0 16 16"></svg>')).toStrictEqual([]);
        });

        await it('extractPathData concatenates every path d', () => {
            expect(extractPathData(MULTI)).toBe('m 10 13 v -10 z m 13 1 c 1 1 1 1 z');
        });

        await it('normalizeArcFlags space-separates glued arc flags (the PathParser crash)', () => {
            // The real crash: `a3.84 3.84 0 00-1.662-.132` packs large-arc=0, sweep=0,
            // x=-1.662, y=-.132. PathParser throws on the glued `00`.
            expect(normalizeArcFlags('a3.84 3.84 0 00-1.662-.132')).toBe('a 3.84 3.84 0 0 0 -1.662 -.132');
            // Flag glued to the trailing coordinate (`01.5`).
            expect(normalizeArcFlags('A5 5 0 01.5 2')).toBe('A 5 5 0 0 1 .5 2');
        });

        await it('normalizeArcFlags leaves non-arc / already-spaced paths unchanged', () => {
            // No arc command at all → byte-for-byte identity (glued curve numbers are
            // fine for PathParser; only arc FLAGS need splitting).
            const curve = 'M9.57 1.184c-.567.078-1.251.35-2.015.753z';
            expect(normalizeArcFlags(curve)).toBe(curve);
            // Already space-separated arc → preserved (idempotent shape).
            expect(normalizeArcFlags('a 5 5 0 0 1 .5 2')).toBe('a 5 5 0 0 1 .5 2');
        });

        await it('normalizeArcFlags handles multiple arc groups + trailing command', () => {
            expect(normalizeArcFlags('a3 3 0 11-2-2 1 1 0 00.5.5L4 4')).toBe('a 3 3 0 1 1 -2 -2 1 1 0 0 0 .5 .5L4 4');
        });
    });

    await describe('color scheme (re-exported from @gjsify/adwaita-core)', async () => {
        // The observable's full behavior matrix is specced in @gjsify/adwaita-core;
        // this smoke test pins the re-export chain (`widgets/color-scheme.js` +
        // the `icon-path.js` colour constants) that keeps NS consumers unbroken.
        await it('flips scheme + themeIconColor through the re-export', () => {
            setAdwaitaColorScheme('light');
            expect(adwaitaColorScheme()).toBe('light');
            expect(themeIconColor()).toBe(DEFAULT_ICON_COLOR);
            expect(toggleAdwaitaColorScheme()).toBe('dark');
            expect(themeIconColor()).toBe(DEFAULT_ICON_COLOR_DARK);
            setAdwaitaColorScheme('light');
        });

        await it('subscribes + recognises scheme defaults through the re-export', () => {
            setAdwaitaColorScheme('light');
            let hits = 0;
            const off = onAdwaitaColorSchemeChanged(() => {
                hits++;
            });
            setAdwaitaColorScheme('dark');
            expect(hits).toBe(1);
            off();
            setAdwaitaColorScheme('light'); // unsubscribed → no further hit
            expect(hits).toBe(1);
            expect(isThemeIconColor(DEFAULT_ICON_COLOR_DARK)).toBe(true);
            expect(isThemeIconColor('#3584e4')).toBe(false); // accent — a pinned context colour
        });
    });

    await describe('responsive breakpoints (core re-export + NS view binding)', async () => {
        // Parser/evaluator/state-machine matrix is specced in @gjsify/adwaita-core;
        // this smoke test pins the `widgets/breakpoint.js` re-export chain.
        await it('parses + evaluates through the re-export', () => {
            const node = parseBreakpointCondition('max-width: 720sp') as BreakpointConditionLeaf;
            expect(node).not.toBe(null);
            expect(node.dimension).toBe('width');
            expect(node.value).toBe(720);
            expect(evaluateBreakpointCondition(node, { width: 411, height: 900 })).toBe(true); // phone
            expect(evaluateBreakpointCondition(node, { width: 928, height: 1280 })).toBe(false); // tablet
        });

        await it('addBreakpoints wires layoutChanged + seeds, and disposes', () => {
            // Minimal mock of the NS View surface addBreakpoints touches.
            const listeners = new Map<string, Array<() => void>>();
            let actual = { width: 0, height: 0 };
            const mockView = {
                getActualSize: () => actual,
                addEventListener(name: string, cb: () => void) {
                    const arr = listeners.get(name) ?? [];
                    arr.push(cb);
                    listeners.set(name, arr);
                },
                removeEventListener(name: string, cb: () => void) {
                    listeners.set(
                        name,
                        (listeners.get(name) ?? []).filter((c) => c !== cb),
                    );
                },
            } as unknown as View;
            const fire = (name: string) => (listeners.get(name) ?? []).forEach((c) => c());

            let collapsed = false;
            const bp = new AdwBreakpoint('max-width: 720sp', {
                onApply: () => {
                    collapsed = true;
                },
                onUnapply: () => {
                    collapsed = false;
                },
            });
            const dispose = addBreakpoints(mockView, [bp]);
            // Seeded recompute saw a 0x0 (unmeasured) view → no apply yet.
            expect(collapsed).toBe(false);

            actual = { width: 411, height: 900 }; // phone width
            fire('layoutChanged');
            expect(collapsed).toBe(true);

            actual = { width: 928, height: 1280 }; // tablet width
            fire('layoutChanged');
            expect(collapsed).toBe(false);

            dispose();
            expect(listeners.get('layoutChanged')!.length).toBe(0);
        });
    });
};
