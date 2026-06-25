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

interface ComboOption {
    label: string;
    value: string;
}

// Mirrors AdwComboRow's selectedIndex/selectedValue <-> ListPicker.selectedIndex.
class MockComboRow {
    private _options: ComboOption[] = [];
    private _index = 0;
    set options(v: ComboOption[]) {
        this._options = v;
    }
    get selectedIndex(): number {
        return this._index;
    }
    set selectedIndex(v: number) {
        this._index = Number.isFinite(v) ? v : 0;
    }
    get selectedValue(): string {
        return this._options[this._index]?.value ?? '';
    }
    set selectedValue(value: string) {
        const idx = this._options.findIndex((o) => o.value === value);
        if (idx >= 0) this._index = idx;
    }
}

// Mirrors AdwSpinRow's clamped value/min/max/step + bump.
class MockSpinRow {
    private _value = 0;
    private _min = 0;
    private _max = 100;
    private _step = 1;
    private _clamp(n: number): number {
        return Math.min(this._max, Math.max(this._min, n));
    }
    get value(): number {
        return this._value;
    }
    set value(v: number) {
        this._value = this._clamp(Number.isFinite(v) ? v : 0);
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
    bump(dir: 1 | -1): void {
        this.value = this._value + dir * this._step;
    }
}

// Mirrors avatarInitials() from src/widgets/adw-avatar.ts.
function mockAvatarInitials(text: string): string {
    const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
    return (words[0]!.charAt(0) + words[words.length - 1]!.charAt(0)).toUpperCase();
}

// Mirrors AdwExpanderRow.expanded toggle (visibility-driven).
class MockExpanderRow {
    private _expanded = false;
    visibility = 'collapse';
    get expanded(): boolean {
        return this._expanded;
    }
    set expanded(v: boolean) {
        this._expanded = !!v;
        this.visibility = this._expanded ? 'visible' : 'collapse';
    }
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

// Mirrors AdwToggleGroup's selected + selectedValue over an options list.
class MockToggleGroup {
    private _options: string[] = [];
    private _selected = 0;
    set options(v: string[]) {
        this._options = v;
    }
    get selected(): number {
        return this._selected;
    }
    set selected(v: number) {
        this._selected = Number.isFinite(v) ? v : 0;
    }
    get selectedValue(): string {
        return this._options[this._selected] ?? '';
    }
}

// Mirrors AdwAlertDialog._orderResponses (default→ok, last→cancel, middle→neutral)
// and the resolve mapping confirm(true|false|undefined) → response id.
class MockAlertDialog {
    private _responses: Array<{ id: string; label: string }> = [];
    private _default: string | null = null;
    private _close = 'close';
    addResponse(id: string, label: string): void {
        this._responses.push({ id, label });
    }
    set defaultResponse(id: string | null) {
        this._default = id;
    }
    set closeResponse(id: string) {
        this._close = id || 'close';
    }
    order(): { ok?: string; cancel?: string; neutral?: string } {
        const ok = this._responses.find((r) => r.id === this._default) ?? this._responses[0];
        const remaining = this._responses.filter((r) => r !== ok);
        const cancel = remaining[remaining.length - 1];
        const neutral = remaining.length >= 2 ? remaining[0] : undefined;
        return { ok: ok?.id, cancel: cancel?.id, neutral: neutral?.id };
    }
    resolve(result: boolean | undefined): string {
        const o = this.order();
        if (result === true && o.ok) return o.ok;
        if (result === false && o.cancel) return o.cancel;
        if (result === undefined && o.neutral) return o.neutral;
        return this._close;
    }
    usesActionSheet(): boolean {
        return this._responses.length > 3;
    }
}

// Mirrors the AdwToast value object (timeout/buttonLabel defaulting).
const DEFAULT_TOAST_TIMEOUT = 5000;
class MockToast {
    title: string;
    timeout: number;
    buttonLabel: string;
    constructor(title = '', options: { timeout?: number; buttonLabel?: string } = {}) {
        this.title = title;
        this.timeout = options.timeout ?? DEFAULT_TOAST_TIMEOUT;
        this.buttonLabel = options.buttonLabel ?? '';
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

    await describe('AdwComboRow selection (mock)', async () => {
        await it('resolves selectedValue from selectedIndex', () => {
            const row = new MockComboRow();
            row.options = [
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ];
            row.selectedIndex = 1;
            expect(row.selectedValue).toBe('b');
        });

        await it('selectedValue setter moves selectedIndex', () => {
            const row = new MockComboRow();
            row.options = [
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ];
            row.selectedValue = 'b';
            expect(row.selectedIndex).toBe(1);
        });

        await it('returns empty string for out-of-range index', () => {
            const row = new MockComboRow();
            row.options = [{ label: 'One', value: 'a' }];
            row.selectedIndex = 5;
            expect(row.selectedValue).toBe('');
        });
    });

    await describe('AdwSpinRow numeric stepper (mock)', async () => {
        await it('clamps the value to [min, max]', () => {
            const row = new MockSpinRow();
            row.min = 0;
            row.max = 10;
            row.value = 99;
            expect(row.value).toBe(10);
            row.value = -5;
            expect(row.value).toBe(0);
        });

        await it('bumps by step and clamps', () => {
            const row = new MockSpinRow();
            row.min = 0;
            row.max = 4;
            row.step = 2;
            row.bump(1);
            expect(row.value).toBe(2);
            row.bump(1);
            expect(row.value).toBe(4);
            row.bump(1);
            expect(row.value).toBe(4); // clamped at max
        });

        await it('re-clamps the current value when min rises above it', () => {
            const row = new MockSpinRow();
            row.value = 3;
            row.min = 5;
            expect(row.value).toBe(5);
        });
    });

    await describe('AdwExpanderRow disclosure (mock)', async () => {
        await it('toggles visibility with expanded', () => {
            const row = new MockExpanderRow();
            expect(row.expanded).toBe(false);
            expect(row.visibility).toBe('collapse');
            row.expanded = true;
            expect(row.visibility).toBe('visible');
            row.expanded = false;
            expect(row.visibility).toBe('collapse');
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

    await describe('AdwToggleGroup selection (mock)', async () => {
        await it('resolves selectedValue from the options list', () => {
            const tg = new MockToggleGroup();
            tg.options = ['Day', 'Week', 'Month'];
            tg.selected = 2;
            expect(tg.selectedValue).toBe('Month');
        });

        await it('returns empty string when out of range', () => {
            const tg = new MockToggleGroup();
            tg.options = ['Day'];
            tg.selected = 5;
            expect(tg.selectedValue).toBe('');
        });
    });

    await describe('AdwAlertDialog response ordering (mock)', async () => {
        await it('maps confirm(true|false|undefined) to ok/cancel/neutral ids', () => {
            const d = new MockAlertDialog();
            d.addResponse('save', 'Save');
            d.addResponse('discard', 'Discard');
            d.addResponse('cancel', 'Cancel');
            d.defaultResponse = 'save';
            expect(d.resolve(true)).toBe('save'); // OK = default
            expect(d.resolve(false)).toBe('cancel'); // cancel = last
            expect(d.resolve(undefined)).toBe('discard'); // neutral = middle
        });

        await it('falls back to closeResponse when a slot is absent', () => {
            const d = new MockAlertDialog();
            d.addResponse('ok', 'OK');
            d.closeResponse = 'dismissed';
            expect(d.resolve(undefined)).toBe('dismissed'); // no neutral
        });

        await it('switches to an action sheet for more than three responses', () => {
            const d = new MockAlertDialog();
            d.addResponse('a', 'A');
            d.addResponse('b', 'B');
            d.addResponse('c', 'C');
            d.addResponse('d', 'D');
            expect(d.usesActionSheet()).toBe(true);
        });
    });

    await describe('AdwToast value object (mock)', async () => {
        await it('defaults the timeout and has no button by default', () => {
            const t = new MockToast('Saved');
            expect(t.title).toBe('Saved');
            expect(t.timeout).toBe(5000);
            expect(t.buttonLabel).toBe('');
        });

        await it('honours explicit timeout and action label', () => {
            const t = new MockToast('Deleted', { timeout: 2000, buttonLabel: 'Undo' });
            expect(t.timeout).toBe(2000);
            expect(t.buttonLabel).toBe('Undo');
        });
    });
};
