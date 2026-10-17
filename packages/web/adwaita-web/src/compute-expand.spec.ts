// `gtk_widget_compute_expand` in a box (gtkwidget.c:8387-8423, gtkboxlayout.c:793): a widget
// that authored no `hexpand` grows when a descendant does, an explicit value stops the walk, and
// the answer follows the tree as it changes. Plus the two size facts the same app layout broke
// on: a scrolled window requests 0 on a scrolling axis (gtkscrolledwindow.c:1821-1960), and a
// page leaving a view stack takes none of the stack's marks with it (adw-view-stack.c:1184-1205).
import { describe, expect, it } from '@gjsify/unit';

import type { AdwViewStack } from './elements/adw-view-stack.js';

function mount(html: string, width = 600, height = 600): { host: HTMLElement; box: (sel: string) => DOMRect } {
    const host = document.createElement('div');
    host.style.cssText = `width:${width}px;height:${height}px;display:flex;flex-direction:column`;
    host.innerHTML = html;
    document.body.appendChild(host);
    const box = (sel: string) => (host.querySelector(sel) as HTMLElement).getBoundingClientRect();
    return { host, box };
}

/** The box writes its computed values from a MutationObserver: one microtask, then a frame. */
const settle = () => new Promise((resolve) => requestAnimationFrame(resolve));

export const ComputeExpandTest = async () => {
    await describe('computed expand in a <gtk-box>', async () => {
        await it('a bin with an hexpand descendant fills a horizontal box', async () => {
            const { host, box } = mount(
                `<gtk-box id="row" style="width:600px">
                   <div id="fixed" style="width:100px"></div>
                   <adw-bin id="bin"><gtk-box><div id="leaf" hexpand></div></gtk-box></adw-bin>
                 </gtk-box>`,
            );
            await settle();
            expect(host.querySelector('#bin')!.hasAttribute('data-computed-hexpand')).toBe(true);
            expect(box('#bin').width).toBe(500);
            host.remove();
        });

        await it('an explicit hexpand=false on an intermediate stops propagation', async () => {
            const { host, box } = mount(
                `<gtk-box style="width:600px">
                   <adw-bin id="bin"><gtk-box hexpand="false"><div style="width:10px" hexpand></div></gtk-box></adw-bin>
                 </gtk-box>`,
            );
            await settle();
            expect(host.querySelector('#bin')!.hasAttribute('data-computed-hexpand')).toBe(false);
            expect(box('#bin').width).toBe(10);
            host.remove();
        });

        await it('a leaf widget does not propagate, and a hidden one never expands', async () => {
            const { host } = mount(
                `<gtk-box>
                   <gtk-label id="label"><div hexpand></div></gtk-label>
                   <adw-bin id="bin"><gtk-box hidden><div hexpand></div></gtk-box></adw-bin>
                 </gtk-box>`,
            );
            await settle();
            expect(host.querySelector('#label')!.hasAttribute('data-computed-hexpand')).toBe(false);
            expect(host.querySelector('#bin')!.hasAttribute('data-computed-hexpand')).toBe(false);
            host.remove();
        });

        await it('propagation updates after a runtime reparent', async () => {
            const { host, box } = mount(
                `<gtk-box style="width:600px">
                   <div style="width:100px"></div>
                   <adw-bin id="bin"><div style="width:20px"></div></adw-bin>
                 </gtk-box>
                 <div id="parking"><div id="editor" hexpand></div></div>`,
            );
            await settle();
            expect(box('#bin').width).toBe(20);
            const bin = host.querySelector('#bin')!;
            bin.replaceChildren(host.querySelector('#editor')!);
            await settle();
            expect(bin.hasAttribute('data-computed-hexpand')).toBe(true);
            expect(box('#bin').width).toBe(500);
            host.querySelector('#parking')!.append(host.querySelector('#editor')!);
            await settle();
            expect(bin.hasAttribute('data-computed-hexpand')).toBe(false);
            host.remove();
        });

        await it('rewriting a label text does not recompute, adding a widget does', async () => {
            const { host } = mount(
                `<gtk-box>
                   <adw-bin id="bin"><gtk-box id="inner"><gtk-label id="label">0000</gtk-label><div hexpand></div></gtk-box></adw-bin>
                 </gtk-box>`,
            );
            await settle();
            const bin = host.querySelector('#bin')!;
            expect(bin.hasAttribute('data-computed-hexpand')).toBe(true);
            // Drop the mark by hand: only a recompute would write it back.
            bin.removeAttribute('data-computed-hexpand');
            host.querySelector('#label')!.textContent = 'FFFF';
            await settle();
            expect(bin.hasAttribute('data-computed-hexpand')).toBe(false);
            host.querySelector('#inner')!.append(document.createElement('gtk-label'));
            await settle();
            expect(bin.hasAttribute('data-computed-hexpand')).toBe(true);
            host.remove();
        });

        await it('a registered subclass of a bin propagates as its base does', async () => {
            const Bin = customElements.get('adw-bin')!;
            const tag = 'compute-expand-test-bin';
            if (!customElements.get(tag)) customElements.define(tag, class extends Bin {});
            const { host, box } = mount(
                `<gtk-box style="width:600px">
                   <div style="width:100px"></div>
                   <${tag} id="sub"><div hexpand></div></${tag}>
                 </gtk-box>`,
            );
            await settle();
            expect(box('#sub').width).toBe(500);
            host.remove();
        });
    });

    await describe('<gtk-scrolled-window> requests no content size on a scrolling axis', async () => {
        await it('in a horizontal box inside a 600px-high box it stays 600 and scrolls', async () => {
            const { host, box } = mount(
                `<gtk-box orientation="vertical" style="height:600px">
                   <gtk-box id="row" vexpand>
                     <gtk-scrolled-window id="sw" hexpand>
                       <div style="height:2000px;width:50px"></div>
                     </gtk-scrolled-window>
                   </gtk-box>
                 </gtk-box>`,
            );
            await settle();
            expect(box('#row').height).toBe(600);
            expect(box('#sw').height).toBe(600);
            const viewport = host.querySelector('#sw gtk-viewport') as HTMLElement;
            expect(viewport.getBoundingClientRect().height).toBe(600);
            expect(viewport.scrollHeight > 600).toBe(true);
            host.remove();
        });

        await it('sizes the measured chain: split-view content fills, the editor bin gets width', async () => {
            const { host, box } = mount(
                `<adw-overlay-split-view id="osv" style="height:600px">
                   <div slot="sidebar" style="width:100px"></div>
                   <gtk-box id="centerRight">
                     <adw-bin id="editor"><div hexpand style="height:10px"></div></adw-bin>
                     <gtk-scrolled-window id="right" hscrollbar-policy="never" style="flex:0 1 auto">
                       <div style="width:150px;height:3000px"></div>
                     </gtk-scrolled-window>
                   </gtk-box>
                 </adw-overlay-split-view>`,
                800,
                600,
            );
            await settle();
            expect(box('#centerRight').height).toBe(box('#osv').height);
            expect(box('#editor').width > 0).toBe(true);
            expect(box('#right').height).toBe(box('#centerRight').height);
            host.remove();
        });
    });

    await describe('<adw-view-stack> page removal', async () => {
        await it('a child removed from a view stack loses the stack classes', async () => {
            const { host } = mount('<adw-view-stack id="s"></adw-view-stack><div id="elsewhere"></div>');
            const stack = host.querySelector('#s') as AdwViewStack;
            const a = document.createElement('div');
            const b = document.createElement('div');
            stack.add(a, 'a');
            stack.add(b, 'b');
            expect(a.classList.contains('active-view')).toBe(true);
            expect(b.hidden).toBe(true);

            stack.removePage('a');
            expect(a.classList.contains('adw-view-stack-child')).toBe(false);
            expect(a.classList.contains('active-view')).toBe(false);
            expect(a.dataset.name).toBe(undefined);

            // A plain DOM reparent is `gtk_widget_unparent` reaching the stack too.
            host.querySelector('#elsewhere')!.append(b);
            await settle();
            expect(b.classList.contains('adw-view-stack-child')).toBe(false);
            expect(b.hidden).toBe(false);
            expect(stack.pages.length).toBe(0);
            host.remove();
        });
    });
};
