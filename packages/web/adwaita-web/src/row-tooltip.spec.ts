// `Gtk.Widget:tooltip-text` on the boxed-list rows, and the two sensitivity doors
// `<adw-toggle-group>` gained with it.
//
// THE COLLISION THESE TESTS EXIST FOR: a row's `title` attribute is its LABEL
// (`Adw.PreferencesRow:title`), and `HTMLElement.title` reflects the same attribute — so
// the browser's own tooltip channel cannot be written on the host without blanking the
// label. `src/row-tooltip.ts` puts it on the row's PARTS instead, and Firefox resolves a
// tooltip by walking up from the hovered node until an element carries a non-empty
// `title`. What the tests pin is that consequence: the parts carry the text, the host's
// label survives, and a part the element gave a tooltip of its own keeps it.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwToggleGroup } from './elements/adw-toggle-group.js';

/** Connect, run, disconnect — the same helper `keyboard-operable.spec.ts` drives with. */
function withWidget(make: () => HTMLElement, body: (el: HTMLElement) => void): void {
    const el = make();
    document.body.appendChild(el);
    try {
        body(el);
    } finally {
        el.remove();
    }
}

/** The parts `applyRowTooltip` is expected to have written `tooltip-text` onto. */
const TOOLTIPPED_PARTS: Record<string, string[]> = {
    'adw-action-row': ['.adw-action-row-prefix', '.adw-action-row-text', '.adw-action-row-suffix'],
    'adw-button-row': ['.adw-button-row-contents'],
    'adw-combo-row': ['.adw-row-text', '.adw-row-value', 'select'],
    'adw-expander-row': ['.adw-expander-row-header'],
    'adw-preferences-row': ['.adw-row-title', '.adw-preferences-row-content'],
    'adw-spin-row': ['.adw-row-text', '.adw-spin-control'],
    'adw-switch-row': ['.adw-switch-row-prefix', '.adw-row-text'],
};

/** Every `title` attribute inside `el`, as `selector → value`, absent ones as `null`. */
function partTitles(el: Element): Record<string, string | null> {
    const titles: Record<string, string | null> = {};
    for (const selector of TOOLTIPPED_PARTS[el.localName]) {
        titles[selector] = el.querySelector(selector)?.getAttribute('title') ?? null;
    }
    return titles;
}

/**
 * Measure the vertical coverage of tooltip-marked parts against the row's bounding box.
 * Returns the ratio of covered height to row height (1.0 = full coverage).
 */
function tooltipCoverageRatio(el: HTMLElement): number {
    const rowRect = el.getBoundingClientRect();
    const parts = TOOLTIPPED_PARTS[el.localName] ?? [];
    if (parts.length === 0) return 0;

    // Union of all tooltip parts' bounding boxes
    let top = Infinity;
    let bottom = -Infinity;
    for (const selector of parts) {
        const part = el.querySelector(selector) as HTMLElement | null;
        if (!part) continue;
        const rect = part.getBoundingClientRect();
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
    }
    if (!isFinite(top) || !isFinite(bottom)) return 0;
    const covered = bottom - top;
    return covered / rowRect.height;
}

export const AdwRowTooltipTest = async () => {
    await describe('row tooltip-text (Gtk.Widget:tooltip-text)', async () => {
        // One case per row family, and the assertion is the SAME for all of them: the
        // parts carry the text and the host keeps its label. A row that wrote the tooltip
        // on the host instead would blank `title` here, which is the whole failure mode.
        for (const [tag, selectors] of Object.entries(TOOLTIPPED_PARTS)) {
            await it(`${tag} puts tooltip-text on its parts and keeps its title label`, () => {
                withWidget(
                    () => {
                        const el = document.createElement(tag);
                        el.setAttribute('title', 'Wi-Fi');
                        el.setAttribute('tooltip-text', 'Connects to the office network');
                        return el;
                    },
                    (el) => {
                        expect(el.getAttribute('title')).toBe('Wi-Fi');
                        expect((el as HTMLElement & { title: string }).title).toBe('Wi-Fi');
                        for (const selector of selectors) {
                            expect(el.querySelector(selector)?.getAttribute('title')).toBe(
                                'Connects to the office network',
                            );
                        }
                    },
                );
            });

            await it(`${tag} clears the tooltip when the attribute goes`, () => {
                withWidget(
                    () => {
                        const el = document.createElement(tag);
                        el.setAttribute('title', 'Wi-Fi');
                        el.setAttribute('tooltip-text', 'Gone soon');
                        return el;
                    },
                    (el) => {
                        expect(partTitles(el)).toStrictEqual(
                            Object.fromEntries(TOOLTIPPED_PARTS[tag].map((selector) => [selector, 'Gone soon'])),
                        );

                        el.removeAttribute('tooltip-text');
                        for (const selector of selectors) {
                            expect(el.querySelector(selector)?.hasAttribute('title')).toBe(false);
                        }
                        // The LABEL is untouched either way.
                        expect(el.getAttribute('title')).toBe('Wi-Fi');
                    },
                );
            });
        }

        await it('adw-entry-row leaves the apply button its own tooltip', () => {
            withWidget(
                () => {
                    const el = document.createElement('adw-entry-row');
                    el.setAttribute('text', 'query');
                    el.setAttribute('show-apply-button', '');
                    el.setAttribute('tooltip-text', 'The search term');
                    return el;
                },
                (el) => {
                    const apply = el.querySelector('button') as HTMLButtonElement;
                    expect(apply.title).not.toBe('The search term');
                    expect(apply.title.length).toBeGreaterThan(0);
                    // The editable area is the part that takes the row's tooltip.
                    expect(el.querySelector('.adw-entry-row-text')?.getAttribute('title')).toBe('The search term');
                },
            );
        });

        await it('adw-password-entry-row inherits the entry row tooltip', () => {
            withWidget(
                () => {
                    const el = document.createElement('adw-password-entry-row');
                    el.setAttribute('title', 'Password');
                    el.setAttribute('tooltip-text', 'At least 12 characters');
                    return el;
                },
                (el) => {
                    expect(el.getAttribute('title')).toBe('Password');
                    expect(el.querySelector('.adw-password-entry-row-text')?.getAttribute('title')).toBe(
                        'At least 12 characters',
                    );
                },
            );
        });

        // BLOCKER 1: the tooltip parts must cover the row's full hit area (height).
        // GTK draws the tooltip over the whole widget; the port was only covering the
        // label text's own height. The `[data-row-tooltip]` marker + `align-self: stretch`
        // in `_row.scss` stretches the parts, and this assertion prevents regression.
        await it("tooltip parts cover the row's full height (>= 0.95 of row height)", () => {
            for (const [tag] of Object.entries(TOOLTIPPED_PARTS)) {
                withWidget(
                    () => {
                        const el = document.createElement(tag);
                        el.setAttribute('title', 'Wi-Fi');
                        el.setAttribute('tooltip-text', 'Connects to the office network');
                        return el;
                    },
                    (el) => {
                        // Force layout so getBoundingClientRect is accurate
                        el.style.position = 'absolute';
                        el.style.top = '-9999px';
                        document.body.appendChild(el);
                        try {
                            const ratio = tooltipCoverageRatio(el);
                            expect(ratio).toBeGreaterThanOrEqual(0.95);
                        } finally {
                            el.remove();
                        }
                    },
                );
            }
        });
    });

    await describe('adw-toggle-group sensitivity', async () => {
        const group = (attrs: Record<string, string>, toggles: string[]) => () => {
            const el = document.createElement('adw-toggle-group');
            for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
            el.innerHTML = toggles.join('');
            return el;
        };
        const buttons = (el: Element) => Array.from(el.querySelectorAll<HTMLButtonElement>('button.adw-toggle'));

        await it('defaults to sensitive, so a bare group is operable', () => {
            withWidget(group({}, ['<adw-toggle label="One"></adw-toggle>']), (el) => {
                const group = el as unknown as AdwToggleGroup;
                expect(group.sensitive).toBe(true);
                expect(el.hasAttribute('disabled')).toBe(false);
                expect(buttons(el)[0].disabled).toBe(false);
            });
        });

        await it('reads `sensitive` by VALUE, not by presence', () => {
            // `GtkWidget:sensitive` defaults to TRUE. Read by presence, the bare element
            // would be insensitive and every group on a page would be dimmed and dead.
            withWidget(group({ sensitive: 'false' }, ['<adw-toggle label="One"></adw-toggle>']), (el) => {
                const group = el as unknown as AdwToggleGroup;
                expect(group.sensitive).toBe(false);
                expect(el.getAttribute('disabled')).toBe('');
                expect(buttons(el)[0].disabled).toBe(true);
            });
        });

        await it('an explicit `sensitive="true"` is sensitive', () => {
            withWidget(group({ sensitive: 'true' }, ['<adw-toggle label="One"></adw-toggle>']), (el) => {
                expect((el as unknown as AdwToggleGroup).sensitive).toBe(true);
                expect(el.hasAttribute('disabled')).toBe(false);
            });
        });

        await it('sensitive is reachable as a property and takes effect live', () => {
            withWidget(
                group({}, ['<adw-toggle label="One"></adw-toggle>', '<adw-toggle label="Two"></adw-toggle>']),
                (el) => {
                    const group = el as unknown as AdwToggleGroup;
                    expect(buttons(el).map((btn) => btn.disabled)).toStrictEqual([false, false]);

                    group.sensitive = false;
                    expect(buttons(el).map((btn) => btn.disabled)).toStrictEqual([true, true]);
                    expect(el.getAttribute('disabled')).toBe('');

                    group.sensitive = true;
                    expect(buttons(el).map((btn) => btn.disabled)).toStrictEqual([false, false]);
                    expect(el.hasAttribute('disabled')).toBe(false);
                },
            );
        });

        await it('one toggle takes `enabled="false"` and only that one', () => {
            // `AdwToggle:enabled` — `add_toggle` spends it on the button it builds
            // (adw-toggle-group.c:871). `boolAttribute` is not its reading: the property
            // defaults TRUE, so a bare `<adw-toggle>` is enabled.
            withWidget(
                group({}, [
                    '<adw-toggle label="One"></adw-toggle>',
                    '<adw-toggle label="Two" enabled="false"></adw-toggle>',
                ]),
                (el) => {
                    expect(buttons(el).map((btn) => btn.disabled)).toStrictEqual([false, true]);
                    expect((el as unknown as AdwToggleGroup).isToggleEnabled(0)).toBe(true);
                    expect((el as unknown as AdwToggleGroup).isToggleEnabled(1)).toBe(false);
                },
            );
        });

        await it('an insensitive toggle cannot be selected', () => {
            // `set_active_toggle` refuses a toggle that is not enabled (:720), so a
            // disabled button and an unreachable selection cannot disagree.
            withWidget(
                group({}, [
                    '<adw-toggle label="One"></adw-toggle>',
                    '<adw-toggle label="Two" enabled="false"></adw-toggle>',
                ]),
                (el) => {
                    buttons(el)[1].click();
                    expect((el as unknown as AdwToggleGroup).active).toBe(0);
                    expect(buttons(el).map((btn) => btn.classList.contains('active'))).toStrictEqual([true, false]);
                    // The reflected `active` is written only on a real CHANGE
                    // (`_selectIndex`), and this press was not one — so it stays absent,
                    // the way a group nobody has touched reads.
                    expect(el.hasAttribute('active')).toBe(false);
                },
            );
        });

        await it('an active-but-insensitive toggle hands the selection to an enabled one', () => {
            // `active="1"` beside `<adw-toggle enabled="false">` is a pair upstream cannot
            // express — `adw_toggle_set_enabled` clears the selection instead (:1659). Left
            // alone it would be a checked radio nothing can focus or click.
            withWidget(
                group({ active: '1' }, [
                    '<adw-toggle label="One"></adw-toggle>',
                    '<adw-toggle label="Two" enabled="false"></adw-toggle>',
                ]),
                (el) => {
                    expect((el as unknown as AdwToggleGroup).active).toBe(0);
                    expect(buttons(el).map((btn) => btn.classList.contains('active'))).toStrictEqual([true, false]);
                    // And the group's ONE tab stop is on the toggle that can take it.
                    expect(buttons(el).map((btn) => btn.tabIndex)).toStrictEqual([0, -1]);
                },
            );
        });

        await it('a group with no enabled toggle leaves the selection alone', () => {
            withWidget(
                group({}, [
                    '<adw-toggle label="One" enabled="false"></adw-toggle>',
                    '<adw-toggle label="Two" enabled="false"></adw-toggle>',
                ]),
                (el) => {
                    // Nothing to move it to. The selection stays where the core put it
                    // (index 0), so the first button gets tabIndex 0 (the group's one
                    // tab stop) even though it is disabled — the roving filter will
                    // skip it, but the attribute reflects the active index.
                    expect((el as unknown as AdwToggleGroup).active).toBe(0);
                    expect(buttons(el).every((btn) => btn.disabled)).toBe(true);
                    expect(buttons(el).map((btn) => btn.tabIndex)).toStrictEqual([0, -1]);
                },
            );
        });
    });
};
