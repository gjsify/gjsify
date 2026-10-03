// DOM-level tests for `<gtk-editable-label>`: the stack's visible child, which is what
// `editing` IS (gtkeditablelabel.c:595-599), and the four ways editing ends — Enter commits,
// Escape discards, losing focus commits after the C's grace period, and `editable` FALSE
// stops without committing.
//
// The draft is the point of the widget: while the entry is visible it holds a text the label
// does not have yet, so every row here checks what the LABEL says afterwards and not only
// what the entry did.

import { describe, expect, it } from '@gjsify/unit';

import type { GtkEditableLabel } from './elements/gtk-editable-label.js';

function mount(attrs: Record<string, string> = {}): GtkEditableLabel {
    const el = document.createElement('gtk-editable-label') as GtkEditableLabel;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    document.body.appendChild(el);
    return el;
}

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('gtk-editable-label'))) el.remove();
}

/** The label half of the stack — `querySelector` is `Element`-typed, so the view is named. */
function labelOf(el: GtkEditableLabel): HTMLElement {
    return el.querySelector<HTMLElement>('.adw-editable-label-label') as HTMLElement;
}

const key = (target: HTMLElement, name: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
};

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const GtkEditableLabelTest = async () => {
    await describe('<gtk-editable-label> the stack', async () => {
        await it('shows the label and not the entry until editing starts', () => {
            const el = mount({ text: 'Ada Lovelace' });
            expect(el.editing).toBe(false);
            expect(el.classList.contains('editing')).toBe(false);
            expect(labelOf(el).hidden).toBe(false);
            expect(el.entry.hidden).toBe(true);
            expect(el.getAttribute('tabindex')).toBe('0');
            unmountAll();
        });

        await it('swaps the visible child when `editing` is set, and takes the tab stop', () => {
            const el = mount({ text: 'Ada Lovelace', editing: '' });
            expect(el.editing).toBe(true);
            expect(el.classList.contains('editing')).toBe(true);
            expect(labelOf(el).hidden).toBe(true);
            expect(el.entry.hidden).toBe(false);
            expect(el.hasAttribute('tabindex')).toBe(false);
            unmountAll();
        });

        await it('notifies on every real change and on none that did not happen', () => {
            const el = mount({ text: 'x' });
            const seen: unknown[] = [];
            el.addEventListener('notify::editing', (event) => seen.push((event as CustomEvent).detail));
            el.editing = true;
            el.editing = true;
            el.editing = false;
            expect(seen).toStrictEqual([{ editing: true }, { editing: false }]);
            unmountAll();
        });
    });

    await describe('<gtk-editable-label> starting', async () => {
        await it('starts on a click of the LABEL, which is where the C puts the gesture', () => {
            const el = mount({ text: 'x' });
            labelOf(el).click();
            expect(el.editing).toBe(true);
            unmountAll();
        });

        // The keys are a binding of the WIDGET (gtkeditablelabel.c:54-63), so the event is
        // dispatched on the host and not on the label node inside the stack.
        await it('starts on Enter, and on Space where the C binds both', () => {
            const label = mount({ text: 'x' });
            key(label, 'Enter');
            expect(label.editing).toBe(true);
            label.editing = false;
            key(label, ' ');
            expect(label.editing).toBe(true);
            unmountAll();
        });

        await it('refuses to start while `editable` is FALSE, as both actions are disabled', () => {
            const el = mount({ text: 'x', editable: 'false' });
            expect(el.editable).toBe(false);
            labelOf(el).click();
            expect(el.editing).toBe(false);
            el.startEditing();
            expect(el.editing).toBe(false);
            unmountAll();
        });
    });

    await describe('<gtk-editable-label> committing and discarding', async () => {
        await it('Enter in the entry COMMITS: the draft becomes the label text', () => {
            const el = mount({ text: 'Ada' });
            el.startEditing();
            el.entry.value = 'Ada Lovelace';
            key(el.entry, 'Enter');
            expect(el.editing).toBe(false);
            expect(el.text).toBe('Ada Lovelace');
            expect(el.querySelector('.adw-editable-label-label')?.textContent).toBe('Ada Lovelace');
            unmountAll();
        });

        await it('Escape in the entry DISCARDS it: the label keeps what it had', () => {
            const el = mount({ text: 'Ada' });
            el.startEditing();
            el.entry.value = 'Ada Lovelace';
            key(el.entry, 'Escape');
            expect(el.editing).toBe(false);
            expect(el.text).toBe('Ada');
            expect(el.querySelector('.adw-editable-label-label')?.textContent).toBe('Ada');
            // …and the entry is reset, so the next edit starts from the committed text.
            el.startEditing();
            expect(el.entry.value).toBe('Ada');
            unmountAll();
        });

        await it("losing focus COMMITS, after the C's grace period", async () => {
            const el = mount({ text: 'Ada' });
            el.startEditing();
            el.entry.value = 'Ada Lovelace';
            const outside = document.createElement('button');
            document.body.appendChild(outside);
            el.dispatchEvent(new FocusEvent('focusout', { bubbles: false, relatedTarget: outside }));
            // Inside the grace period nothing has happened yet.
            expect(el.editing).toBe(true);
            await settle(160);
            expect(el.editing).toBe(false);
            expect(el.text).toBe('Ada Lovelace');
            outside.remove();
            unmountAll();
        });

        await it('a focus move WITHIN the widget is not leaving it', async () => {
            const el = mount({ text: 'Ada' });
            el.startEditing();
            el.entry.value = 'Ada Lovelace';
            el.dispatchEvent(new FocusEvent('focusout', { bubbles: false, relatedTarget: el }));
            await settle(160);
            expect(el.editing).toBe(true);
            unmountAll();
        });

        await it('`editable="false"` stops editing without committing', () => {
            const el = mount({ text: 'Ada' });
            el.startEditing();
            el.entry.value = 'Ada Lovelace';
            el.editable = false;
            expect(el.editing).toBe(false);
            expect(el.text).toBe('Ada');
            unmountAll();
        });

        await it('the label does not follow `text` while a draft is in the entry', () => {
            const el = mount({ text: 'Ada' });
            el.startEditing();
            el.setAttribute('text', 'Grace Hopper');
            expect(el.querySelector('.adw-editable-label-label')?.textContent).toBe('Ada');
            expect(el.text).toBe('Grace Hopper');
            unmountAll();
        });
    });

    await describe('<gtk-editable-label> look', async () => {
        await it('paints the view colours upstream gives the entry node', () => {
            const el = mount({ text: 'Ada', editing: '' });
            // `_labels.scss:94-97` writes `--view-bg-color` / `--view-fg-color` onto the
            // entry, and the tokens move with the OS theme — so the row compares against a
            // probe that resolves the same token rather than naming either colour.
            const probe = document.createElement('div');
            probe.style.backgroundColor = 'var(--view-bg-color)';
            document.body.appendChild(probe);
            expect(getComputedStyle(el.entry).backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
            expect(getComputedStyle(el.entry).color).toBe(getComputedStyle(el).color);
            probe.remove();
            unmountAll();
        });
    });
};
