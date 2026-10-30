// The widget-tree walkers `widgetTreeMembers()` puts on every registered class: they answer
// with WIDGETS, the way `gtk_widget_get_first_child` does, and step over the elements a port
// builds for a widget's own insides (`isWidgetNode`). The element-class copy of the same rule
// is adwaita-web's `widget-element` half, exercised in the browser suite.
//
// No DOM here: the walkers only read `localName` and the five element links, so a plain object
// tree is enough and this suite runs wherever the core suite runs.

import { describe, expect, it } from '@gjsify/unit';

import { isWidgetNode, widgetTreeMembers } from './widget-members.js';

interface FakeNode {
    localName: string;
    firstElementChild: FakeNode | null;
    lastElementChild: FakeNode | null;
    nextElementSibling: FakeNode | null;
    previousElementSibling: FakeNode | null;
    parentElement: FakeNode | null;
}

/** A parent with `children`, linked the way the DOM links them. */
function node(localName: string, children: FakeNode[] = []): FakeNode {
    const self: FakeNode = {
        localName,
        firstElementChild: children[0] ?? null,
        lastElementChild: children[children.length - 1] ?? null,
        nextElementSibling: null,
        previousElementSibling: null,
        parentElement: null,
    };
    children.forEach((child, i) => {
        child.parentElement = self;
        child.previousElementSibling = children[i - 1] ?? null;
        child.nextElementSibling = children[i + 1] ?? null;
    });
    return self;
}

const members = widgetTreeMembers();
const call = (name: string, on: FakeNode): FakeNode | null =>
    (members[name] as (this: FakeNode) => FakeNode | null).call(on);

export default async () => {
    await describe('isWidgetNode', async () => {
        await it('a custom-element name is a widget — the hyphen the DOM requires', () => {
            expect(isWidgetNode({ localName: 'gtk-label' })).toBe(true);
            expect(isWidgetNode({ localName: 'gjsify-source-view' })).toBe(true);
        });

        await it("a built-in element is a port's own insides, not a widget", () => {
            expect(isWidgetNode({ localName: 'span' })).toBe(false);
            expect(isWidgetNode({ localName: 'div' })).toBe(false);
        });

        await it('nothing is not a widget', () => {
            expect(isWidgetNode(null)).toBe(false);
            expect(isWidgetNode(undefined)).toBe(false);
        });
    });

    await describe("the widget-tree walkers skip a port's own DOM", async () => {
        await it("get_first_child passes the wrapper a label's markup built", () => {
            const label = node('gtk-label');
            const box = node('gtk-box', [node('span'), node('div'), label]);
            expect(call('get_first_child', box)).toBe(label);
        });

        await it('get_last_child walks backwards past the same kind of node', () => {
            const button = node('gtk-button');
            const box = node('gtk-box', [button, node('span'), node('div')]);
            expect(call('get_last_child', box)).toBe(button);
        });

        await it('get_next_sibling and get_prev_sibling hop over what lies between', () => {
            const first = node('gtk-label');
            const last = node('gtk-button');
            node('gtk-box', [first, node('span'), node('div'), last]);
            expect(call('get_next_sibling', first)).toBe(last);
            expect(call('get_prev_sibling', last)).toBe(first);
        });

        await it('get_parent reports the nearest ancestor that is a widget', () => {
            const label = node('gtk-label');
            const box = node('gtk-box', [node('div', [node('span', [label])])]);
            expect(call('get_parent', label)).toBe(box);
        });

        await it("a widget whose children are all a port's own is a LEAF, not a TypeError", () => {
            const label = node('gtk-label', [node('span'), node('span')]);
            expect(call('get_first_child', label)).toBeNull();
            expect(call('get_last_child', label)).toBeNull();
        });

        await it('a widget alone in the tree has no siblings and no parent', () => {
            const only = node('gtk-label');
            expect(call('get_next_sibling', only)).toBeNull();
            expect(call('get_prev_sibling', only)).toBeNull();
            expect(call('get_parent', only)).toBeNull();
        });

        await it('a depth-first walk reaches every widget and nothing else', () => {
            // The shape a rendered document has: a port's own nodes sit BESIDE the widgets,
            // never around them, so skipping them at each level loses nothing. (Measured on
            // Learn6502's tutorial: every one of its 26 code blocks and 155 labels is still
            // reached, and no widget hides behind a plain wrapper.)
            const tree = node('gtk-box', [
                node('gtk-label', [node('span'), node('span')]),
                node('div'),
                node('gtk-box', [node('span'), node('gjsify-source-view', [node('div')])]),
            ]);
            const seen: string[] = [];
            const walk = (root: FakeNode) => {
                for (let at = call('get_first_child', root); at !== null; at = call('get_next_sibling', at)) {
                    seen.push(at.localName);
                    walk(at);
                }
            };
            walk(tree);
            expect(seen).toStrictEqual(['gtk-label', 'gtk-box', 'gjsify-source-view']);
        });
    });
};
