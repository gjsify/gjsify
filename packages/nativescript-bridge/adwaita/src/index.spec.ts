// @gjsify/adwaita-nativescript — unit tests.
//
// These run on GJS (and Node), where neither the NativeScript runtime globals
// (`java` / `NSFileManager` / `registerElement`) nor `@nativescript/core` exist.
// We therefore exercise only the parts that are pure-TS-testable off-device:
//   - the `assertNativeScript()` guard (must throw 'Platform not supported'),
//   - the font wiring helpers (pure strings / booleans),
//   - the `registerAdwaitaElements()` no-op-when-global-absent contract,
//   - the `active` <-> `Switch.checked` accessor logic, validated against a
//     standalone mock that mirrors the real widget's binding (importing the real
//     widget classes would require `@nativescript/core` at module-eval, which is
//     absent here — the same reason `@gjsify/native-fs-bridge` keeps its spec to
//     guard-throwing functions only).

import { describe, it, expect } from '@gjsify/unit';

// IMPORTANT: import the NS-core-free surface from its OWN modules, NOT from
// `./index.js`. The package root re-exports the widget classes, whose modules
// `import { GridLayout } from '@nativescript/core'` at top level — that bare
// specifier is unresolvable off NativeScript and would fail the test bundle
// before any guard could run. `@gjsify/native-platform` and `./fonts.js` are
// pure-TS (no `@nativescript/core` value imports), so they load everywhere.
import { assertNativeScript, isNativeScript } from '@gjsify/native-platform';
import {
    ADWAITA_SANS_FONT_FAMILY,
    ADWAITA_SANS_TTF_FILES,
    adwaitaFontInstallInstructions,
    hasAdwaitaSans,
} from './fonts.js';
// `row-press.js` imports only TYPES from `@nativescript/core` (no `extends
// GridLayout`), so — unlike the widget classes — it carries no runtime
// `@nativescript/core` value import and loads off-device. We test the REAL helper.
import { attachRowPressFeedback } from './widgets/row-press.js';
import type { TouchGestureEventData, View } from '@nativescript/core';
// `icon-path.js` is pure (no `@nativescript/core` import), so the real symbolic-icon
// path extraction is unit-testable off-device.
import { extractIconPaths, extractPathData, normalizeArcFlags } from './widgets/icon-path.js';
import { DEFAULT_ICON_COLOR, DEFAULT_ICON_COLOR_DARK } from './widgets/icon-path.js';
// The color-scheme observable + the breakpoint parser/evaluator/state machine
// are HEADLESS and moved to `@gjsify/adwaita-core` (ADR 0004). Their behavior
// matrix is specced THERE; here we import through the NS re-export shims to pin
// the no-consumer-break guarantee, plus test the NS-specific `addBreakpoints`
// view binding against a tiny mock view.
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
// The AdwToast value object + the AdwToastQueue one-at-a-time/auto-dismiss state
// machine and the alert-dialog response model (AdwAlertResponses) are HEADLESS and
// moved to `@gjsify/adwaita-core` (ADR 0004). Their behavior matrices are specced
// THERE (`toast.spec.ts` / `dialog.spec.ts`); here we import the moved classes to
// smoke-test the surface. Unlike breakpoint/color-scheme — whose NS shims are
// import-safe — the NS `AdwToastOverlay` (a `GridLayout`) and `AdwAlertDialog` (an
// `Observable`) pull `@nativescript/core` at module-eval, so they can't load in
// this off-device spec; the built `lib/esm` re-export is verified separately.
import { AdwAlertResponses, AdwToast, AdwToastQueue, DEFAULT_TOAST_TIMEOUT } from '@gjsify/adwaita-core';
import type { ToastScheduler, ToastTimerHandle } from '@gjsify/adwaita-core';
// The row interaction state machines (expander/combo/spin/toggle-group) are HEADLESS
// and moved to `@gjsify/adwaita-core` (ADR 0004). Their clamp/step/selection/toggle
// matrices are specced THERE (`rows.spec.ts`); here we import the moved classes to
// smoke-test the surface the NS row widgets (the `@nativescript/core`-backed render
// halves that can't load off-device) now compose + re-export.
import { ComboState, ExpanderState, SpinState, ToggleGroupState } from '@gjsify/adwaita-core';

// The XML-registration helper only touches the global `registerElement` (it does
// not extend any `@nativescript/core` class at module-eval), so its own module is
// import-safe off-device — but it lives in the widgets barrel which DOES pull the
// classes. Re-implement its absent-global no-op contract inline to keep this spec
// free of the `@nativescript/core` import chain.
function registerAdwaitaElementsNoopProbe(): void {
    // Mirrors widgets/index.ts: returns silently when registerElement is absent.
    const g = globalThis as { registerElement?: unknown };
    if (typeof g.registerElement !== 'function') return;
}

// Standalone re-implementation of AdwSwitchRow's active<->checked binding, kept
// in lockstep with src/widgets/adw-switch-row.ts. Lets us assert the accessor
// semantics without instantiating the @nativescript/core-backed class.
interface MockSwitch {
    checked: boolean;
}

class MockSwitchRow {
    private _switch: MockSwitch;
    public notified: boolean[] = [];

    constructor(sw: MockSwitch = { checked: false }) {
        this._switch = sw;
    }

    get active(): boolean {
        return this._switch.checked;
    }

    set active(value: boolean) {
        const next = !!value;
        if (this._switch.checked !== next) {
            this._switch.checked = next;
        }
    }

    // Emulates the checkedChange -> notify::active re-emit.
    flip(): void {
        this._switch.checked = !this._switch.checked;
        this.notified.push(this._switch.checked);
    }
}

// --- Mocks for the new Tier-1 widgets (mirror the real accessor logic, kept in
// lockstep with the corresponding src/widgets/adw-*.ts modules). Importing the
// real classes would evaluate `import { GridLayout } from '@nativescript/core'`
// at module-eval, which is unresolvable off NativeScript. ---

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

// AdwComboRow's selectedIndex↔selectedValue mapping (ComboState), AdwSpinRow's
// clamped value/min/max/step + stepping (SpinState), AdwExpanderRow's disclosure
// toggle (ExpanderState) and AdwToggleGroup's segment selection (ToggleGroupState)
// are HEADLESS and moved to `@gjsify/adwaita-core` (ADR 0004) — specced there in
// `rows.spec.ts`. Their former mock stand-ins are gone; the smoke tests below drive
// the real state machines (imported above) to pin the moved surface, exactly like
// the toast/dialog re-export smoke tests.

// Mirrors AdwSliderRow's clamp-then-snap-to-step (the RANGE slider). Kept in
// lockstep with src/widgets/adw-slider-row.ts `_snap`.
class MockSliderRow {
    private _value = 0;
    private _min = 0;
    private _max = 100;
    private _step = 1;
    private _snap(n: number): number {
        const clamped = Math.min(this._max, Math.max(this._min, n));
        const steps = Math.round((clamped - this._min) / this._step);
        return Math.min(this._max, this._min + steps * this._step);
    }
    get value(): number {
        return this._value;
    }
    set value(v: number) {
        this._value = this._snap(Number.isFinite(v) ? v : 0);
    }
    set min(v: number) {
        this._min = v;
        this.value = this._value;
    }
    set max(v: number) {
        this._max = v;
        this.value = this._value;
    }
    set step(v: number) {
        this._step = v > 0 ? v : 1;
    }
}

// Mirrors avatarInitials() from src/widgets/adw-avatar.ts.
function mockAvatarInitials(text: string): string {
    const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
    return (words[0]!.charAt(0) + words[words.length - 1]!.charAt(0)).toUpperCase();
}

// --- Mocks for the new Tier-2 widgets (mirror their accessor logic, kept in
// lockstep with the corresponding src/widgets/adw-*.ts modules). ---

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

// Mirrors AdwMenuButton's action()-resolution: a chosen label maps to id/label/
// index (id falls back to label); a cancel (undefined choice) emits nothing.
class MockMenuButton {
    private _items: { id?: string; label: string }[] = [];
    notified: Array<{ id: string; label: string; index: number }> = [];
    set menuItems(items: { id?: string; label: string }[]) {
        this._items = items;
    }
    choose(label: string | undefined): void {
        if (this._items.length === 0) return;
        const labels = this._items.map((it) => it.label);
        const index = label === undefined ? -1 : labels.indexOf(label);
        if (index < 0) return;
        const item = this._items[index];
        this.notified.push({ id: item.id ?? item.label, label: item.label, index });
    }
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

// Mirrors AdwSplitViewBase's show/collapse state + the don't-emit-on-no-change guard.
class MockSplitView {
    private _collapsed = false;
    private _showSidebar = true;
    notified: boolean[] = [];
    get collapsed(): boolean {
        return this._collapsed;
    }
    set collapsed(v: boolean) {
        this._collapsed = !!v;
    }
    get showSidebar(): boolean {
        return this._showSidebar;
    }
    set showSidebar(v: boolean) {
        const next = !!v;
        if (next === this._showSidebar) return;
        this._showSidebar = next;
        this.notified.push(next);
    }
}

// A deterministic scheduler stand-in for the AdwToastQueue re-export smoke test —
// the injected timing seam a renderer supplies (NS wraps `setTimeout`).
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

// Minimal View stand-in for attachRowPressFeedback: records pseudo-class
// add/delete and exposes the captured `touch` handler so the test can drive the
// gesture phases the real platform would dispatch.
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

    await describe('AdwSwitchRow active<->checked binding (mock)', async () => {
        await it('reads active from the underlying switch', () => {
            const row = new MockSwitchRow({ checked: true });
            expect(row.active).toBe(true);
        });

        await it('writes active through to the switch', () => {
            const sw: MockSwitch = { checked: false };
            const row = new MockSwitchRow(sw);
            row.active = true;
            expect(sw.checked).toBe(true);
            expect(row.active).toBe(true);
        });

        await it('coerces truthy/falsy values to a boolean', () => {
            const sw: MockSwitch = { checked: false };
            const row = new MockSwitchRow(sw);
            // @ts-expect-error — intentionally pass a non-boolean to test coercion
            row.active = 1;
            expect(sw.checked).toBe(true);
        });

        await it('flipping the switch records a notify::active-style emission', () => {
            const row = new MockSwitchRow({ checked: false });
            row.flip();
            expect(row.notified).toStrictEqual([true]);
            expect(row.active).toBe(true);
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
        // The full options/index↔value/empty/out-of-range matrix is specced in
        // @gjsify/adwaita-core; this pins the moved surface the NS `AdwComboRow`
        // (the inline-value + chevron + native-chooser render) composes.
        await it('resolves selectedValue from selectedIndex', () => {
            const state = new ComboState();
            state.setOptions([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            state.setSelectedIndex(1);
            expect(state.selectedValue).toBe('b');
        });

        await it('setSelectedValue moves selectedIndex; out-of-range → empty value', () => {
            const state = new ComboState();
            state.setOptions([{ label: 'One', value: 'a' }]);
            state.setSelectedIndex(5);
            expect(state.selectedValue).toBe('');
            state.setOptions([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            expect(state.setSelectedValue('b')).toBe(true);
            expect(state.selectedIndex).toBe(1);
        });
    });

    await describe('AdwSpinRow numeric stepper (core SpinState re-export)', async () => {
        // The full clamp/step-edge matrix is specced in @gjsify/adwaita-core; this
        // pins the moved surface the NS `AdwSpinRow` (the ± stepper render) composes.
        await it('clamps the value and steps to the bounds', () => {
            const state = new SpinState();
            state.setMin(0);
            state.setMax(4);
            state.setValue(99);
            expect(state.value).toBe(4); // clamped
            state.setStep(2);
            state.setValue(0);
            state.increment();
            expect(state.value).toBe(2);
            state.increment();
            state.increment();
            expect(state.value).toBe(4); // clamped at max
        });

        await it('re-clamps the current value when min rises above it', () => {
            const state = new SpinState();
            state.setValue(3);
            state.setMin(5);
            expect(state.value).toBe(5);
        });
    });

    await describe('AdwSliderRow range snap (mock)', async () => {
        await it('clamps to [min, max]', () => {
            const row = new MockSliderRow();
            row.min = 16;
            row.max = 64;
            row.value = 99;
            expect(row.value).toBe(64);
            row.value = 0;
            expect(row.value).toBe(16);
        });

        await it('snaps to the nearest step from min', () => {
            const row = new MockSliderRow();
            row.min = 0;
            row.max = 100;
            row.step = 5;
            row.value = 23;
            expect(row.value).toBe(25);
            row.value = 21;
            expect(row.value).toBe(20);
        });

        await it('snaps relative to a non-zero min', () => {
            const row = new MockSliderRow();
            row.min = 16;
            row.max = 64;
            row.step = 4;
            row.value = 49; // 16 + round(33/4)*4 = 16 + 8*4 = 48
            expect(row.value).toBe(48);
        });
    });

    await describe('AdwExpanderRow disclosure (core ExpanderState re-export)', async () => {
        // The toggle/idempotence matrix is specced in @gjsify/adwaita-core; this
        // pins the moved surface the NS `AdwExpanderRow` (the disclosure render)
        // composes to drive `visibility` + the chevron.
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

    await describe('AdwAvatar initials derivation', async () => {
        await it('derives two-letter initials from first+last word', () => {
            expect(mockAvatarInitials('Ada Lovelace')).toBe('AL');
        });

        await it('uses a single letter for one word', () => {
            expect(mockAvatarInitials('Grace')).toBe('G');
        });

        await it('uses first+last for three or more words', () => {
            expect(mockAvatarInitials('John von Neumann')).toBe('JN');
        });

        await it('returns empty string for blank input', () => {
            expect(mockAvatarInitials('   ')).toBe('');
            expect(mockAvatarInitials('')).toBe('');
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

    await describe('AdwMenuButton activation (mock)', async () => {
        await it('emits id/label/index for a chosen item', () => {
            const mb = new MockMenuButton();
            mb.menuItems = [
                { id: 'about', label: 'About' },
                { id: 'prefs', label: 'Preferences' },
            ];
            mb.choose('Preferences');
            expect(mb.notified).toStrictEqual([{ id: 'prefs', label: 'Preferences', index: 1 }]);
        });

        await it('falls back to label as id and ignores cancel', () => {
            const mb = new MockMenuButton();
            mb.menuItems = [{ label: 'Quit' }];
            mb.choose(undefined); // cancel / dismiss
            mb.choose('Quit');
            expect(mb.notified).toStrictEqual([{ id: 'Quit', label: 'Quit', index: 0 }]);
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

    await describe('AdwNavigationSplitView / AdwOverlaySplitView state (mock)', async () => {
        await it('toggles showSidebar, emitting only on change', () => {
            const sv = new MockSplitView();
            sv.collapsed = true;
            sv.showSidebar = false;
            sv.showSidebar = false; // no change
            sv.showSidebar = true;
            expect(sv.notified).toStrictEqual([false, true]);
        });
    });

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
