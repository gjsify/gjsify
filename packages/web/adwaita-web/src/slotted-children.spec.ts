// Slot adoption, driven in both directions — declared at parse time and appended after
// connect — and required to reach the SAME place.
//
// The invariant this file exists for is an EQUALITY, not a presence: "the child is
// somewhere in the subtree" was true of the bug too. Before `src/slotted-children.ts` a
// `slot="suffix"` control appended after connect stayed a direct child of the host,
// beside the internal sections rather than inside one — still in the subtree, still
// findable by `querySelector`, and laid out somewhere else entirely. So every assertion
// below compares the declared placement against the appended one, box path AND index.
//
// The second half is DERIVED, for the reason `connect-lifecycle.spec.ts` gives about its
// own driver: a per-widget slot spec is one more spec per widget to forget. It reads the
// bindings back off the registered elements (`slottedChildrenOf`), so an element that
// gains a slot enrols itself, and one that stops binding drops out of the driver visibly
// instead of silently.
import { describe, expect, it } from '@gjsify/unit';

import * as adwaitaWeb from './index.js';
// See `exported-elements.ts`: the widget classes live inside the exported `Adw`/`Gtk`
// objects, so a top-level `Object.values` finds only the web-only stragglers.
import { exportedElementClasses } from './exported-elements.js';
import { bindSlottedChildren, slottedChildrenOf } from './slotted-children.js';

/** One microtask checkpoint — where a MutationObserver callback lands. */
const settle = () => Promise.resolve();

/** A host mounted in the document, since adoption is only interesting where a widget is. */
function mounted<T extends HTMLElement>(el: T): T {
    document.body.appendChild(el);
    return el;
}

/**
 * WHERE inside `host` a node sits: the chain of boxes down to its parent, plus its index
 * among that parent's child nodes.
 *
 * The index is half the point. Two children that both reached the right box in the wrong
 * order share a path, and a driver that stopped at the path would call that agreement.
 */
function placement(host: Element, node: Node): string {
    if (node.parentNode === null) return 'detached';
    if (!host.contains(node)) return 'outside';
    const steps: string[] = [];
    for (let el = node.parentElement; el !== null && el !== host; el = el.parentElement) {
        const classes = [...el.classList].sort().join('.');
        steps.unshift(classes === '' ? el.localName : `${el.localName}.${classes}`);
    }
    const index = Array.from(node.parentNode.childNodes).indexOf(node as ChildNode);
    return `${steps.join(' > ')}[${index}]`;
}

/** A probe carrying a slot name, or none at all for the default slot. */
function probe(slot: string | undefined, id: string): HTMLElement {
    const el = document.createElement('div');
    if (slot !== undefined) el.setAttribute('slot', slot);
    el.dataset.probe = id;
    return el;
}

export const AdwSlottedChildrenTest = async () => {
    await describe('bindSlottedChildren', async () => {
        await it('routes the children it was installed over, in document order', async () => {
            const host = mounted(document.createElement('div'));
            const first = probe('side', 'a');
            const second = probe(undefined, 'b');
            const third = probe('side', 'c');
            host.append(first, second, third);

            const side = document.createElement('div');
            side.className = 'side';
            const body = document.createElement('div');
            body.className = 'body';
            bindSlottedChildren(host, [{ name: 'side', into: side }, { into: body }]).install(side, body);

            const report = [first, second, third].map((el) => placement(host, el)).join(' | ');
            host.remove();
            expect(report).toBe('div.side[0] | div.body[0] | div.side[1]');
        });

        await it('routes a child APPENDED after install to the same box, at the next index', async () => {
            const host = mounted(document.createElement('div'));
            const declared = probe('side', 'a');
            host.append(declared);

            const side = document.createElement('div');
            side.className = 'side';
            bindSlottedChildren(host, [{ name: 'side', into: side }]).install(side);

            const late = probe('side', 'b');
            host.append(late);
            await settle();

            const report = `${placement(host, declared)} | ${placement(host, late)}`;
            host.remove();
            expect(report).toBe('div.side[0] | div.side[1]');
        });

        await it('leaves a child whose slot name nothing declares where the author put it', async () => {
            const host = mounted(document.createElement('div'));
            const side = document.createElement('div');
            side.className = 'side';
            // No default slot: with one, an unmatched NAME would silently become default
            // content and render in the wrong box looking deliberate. The native assignment
            // algorithm assigns it nowhere, and so does this.
            bindSlottedChildren(host, [{ name: 'side', into: side }]).install(side);

            const typo = probe('sied', 'a');
            host.append(typo);
            await settle();

            const report = placement(host, typo);
            host.remove();
            expect(report).toBe('[1]');
        });

        await it('re-adopts a child that was appended, removed and appended again', async () => {
            const host = mounted(document.createElement('div'));
            const side = document.createElement('div');
            side.className = 'side';
            bindSlottedChildren(host, [{ name: 'side', into: side }]).install(side);

            const child = probe('side', 'a');
            host.append(child);
            await settle();
            const first = `${placement(host, child)} n=${side.childElementCount}`;

            child.remove();
            await settle();
            const gone = `${placement(host, child)} n=${side.childElementCount}`;

            host.append(child);
            await settle();
            // n=1, not n=2: the node is MOVED back rather than copied, and the removal left
            // no placeholder behind for it to be adopted alongside.
            const again = `${placement(host, child)} n=${side.childElementCount}`;

            host.remove();
            expect(`${first} / ${gone} / ${again}`).toBe('div.side[0] n=1 / detached n=0 / div.side[0] n=1');
        });

        await it('hands a consumed child to the call and leaves nothing of it in the host', async () => {
            const host = mounted(document.createElement('div'));
            const taken: string[] = [];
            const body = document.createElement('div');
            body.className = 'body';
            bindSlottedChildren(host, [
                {
                    claims: (node) => node instanceof Element && node.localName === 'meta',
                    consume: (node) => taken.push((node as Element).getAttribute('name') ?? ''),
                },
                { into: body },
            ]).install(body);

            const data = document.createElement('meta');
            data.setAttribute('name', 'late');
            host.append(data);
            await settle();

            const report = `${taken.join(',')} | ${placement(host, data)} | body=${body.childElementCount}`;
            host.remove();
            expect(report).toBe('late | detached | body=0');
        });
    });

    // Every registered element that binds a slot, both ways round. This is the driver the
    // fix exists for: an element is asked for its own slots and then required to put a
    // declared child and an appended one in the same place.
    await describe('every slotted element adopts a late child where it adopts a declared one', async () => {
        const tags: string[] = [];
        for (const exported of exportedElementClasses(adwaitaWeb)) {
            const tag = customElements.getName(exported);
            if (tag !== null) tags.push(tag);
        }
        tags.sort();

        /** The distinct slot names one element declares — `undefined` is its default slot. */
        function slotNames(tag: string): Array<string | undefined> {
            const el = mounted(document.createElement(tag));
            const binding = slottedChildrenOf(el);
            el.remove();
            if (binding === undefined) return [];
            const names = new Set<string | undefined>();
            for (const slot of binding.slots) names.add(slot.name);
            return [...names];
        }

        const slotted = tags.map((tag) => [tag, slotNames(tag)] as const).filter(([, names]) => names.length > 0);

        await it('finds the elements that declare slots', () => {
            // A driver that scans nothing passes vacuously and reports a green it never
            // earned. A FLOOR, not an exact count: the point of deriving the list is that it
            // grows without this file being edited.
            expect(`slotted elements: ${slotted.length > 8}`).toBe('slotted elements: true');
        });

        for (const [tag, names] of slotted) {
            for (const name of names) {
                const label = name ?? '(default)';
                await it(`<${tag}> slot="${label}"`, async () => {
                    // TWO children per slot, so the comparison pins ORDER and not only the box.
                    const declaredHost = document.createElement(tag);
                    const declaredA = probe(name, 'a');
                    const declaredB = probe(name, 'b');
                    declaredHost.append(declaredA, declaredB);
                    mounted(declaredHost);

                    const lateHost = mounted(document.createElement(tag));
                    const lateA = probe(name, 'a');
                    const lateB = probe(name, 'b');
                    lateHost.append(lateA);
                    lateHost.append(lateB);
                    await settle();

                    const declared = [declaredA, declaredB].map((el) => placement(declaredHost, el)).join(' | ');
                    const late = [lateA, lateB].map((el) => placement(lateHost, el)).join(' | ');
                    // Measure, THEN tear down, THEN assert — the reason
                    // `connect-lifecycle.spec.ts` gives: a host left on the page pushes every
                    // later one down and turns one failure into a cascade naming the wrong
                    // widget.
                    declaredHost.remove();
                    lateHost.remove();
                    expect(`<${tag}> slot=${label} appended: ${late}`).toBe(
                        `<${tag}> slot=${label} appended: ${declared}`,
                    );
                });
            }
        }
    });
};
