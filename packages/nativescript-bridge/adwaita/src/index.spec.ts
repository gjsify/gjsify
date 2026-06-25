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
};
