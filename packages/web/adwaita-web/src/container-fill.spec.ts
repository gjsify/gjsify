// Single-child containers hand their child the WHOLE allocation, on both axes: GtkOverlay's main
// child (gtkoverlay.c size_allocate), AdwToastOverlay's child, GtkStack's visible page
// (gtkstack.c:2778-2831) and AdwBin's child (gtkbinlayout.c:81). A block box gives a child only
// its content height, and a percentage resolves against an indefinite one — these specs pin the
// chain a real window builds: overlay > toast-overlay > stack > bin > view-stack.
import { describe, expect, it } from '@gjsify/unit';

function mount(html: string, width = 400, height = 300): { host: HTMLElement; box: (sel: string) => DOMRect } {
    const host = document.createElement('div');
    host.style.cssText = `width:${width}px;height:${height}px;display:flex;flex-direction:column`;
    host.innerHTML = html;
    document.body.appendChild(host);
    const box = (sel: string) => (host.querySelector(sel) as HTMLElement).getBoundingClientRect();
    return { host, box };
}

export const ContainerFillTest = async () => {
    await describe('single-child containers fill', async () => {
        await it('<gtk-overlay> gives its main child the whole sized overlay', () => {
            const { host, box } = mount('<gtk-overlay style="flex:1"><div id="main"></div></gtk-overlay>');
            expect(box('#main').width).toBe(400);
            expect(box('#main').height).toBe(300);
            host.remove();
        });

        await it('<gtk-overlay> still measures as its main child when unsized', () => {
            const { host, box } = mount('<gtk-overlay id="o"><div style="height:70px"></div></gtk-overlay>');
            expect(box('#o').height).toBe(70);
            host.remove();
        });

        await it('<adw-toast-overlay> gives its child the whole overlay', () => {
            const { host, box } = mount('<adw-toast-overlay style="flex:1"><div id="c"></div></adw-toast-overlay>');
            expect(box('#c').width).toBe(400);
            expect(box('#c').height).toBe(300);
            host.remove();
        });

        await it('a default <gtk-stack> page fills both axes, even with a zero-intrinsic child', () => {
            const { host, box } = mount(
                '<gtk-stack style="flex:1"><div id="p" name="a"><div id="z"></div></div></gtk-stack>',
            );
            expect(box('#p').width).toBe(400);
            expect(box('#p').height).toBe(300);
            host.remove();
        });

        await it('hhomogeneous="false" sizes a page to max-content', () => {
            const { host, box } = mount(
                '<gtk-stack hhomogeneous="false" style="flex:1"><div id="p" name="a" style="width:max-content"><span>hi</span></div></gtk-stack>',
            );
            expect(box('#p').width < 400).toBe(true);
            host.remove();
        });

        await it('overlay > toast-overlay > stack > bin > view-stack fills the box', async () => {
            const { host, box } = mount(
                `<gtk-overlay style="flex:1"><adw-toast-overlay><gtk-stack>
                   <adw-bin id="b" name="a"><adw-view-stack id="v" style="flex:1"></adw-view-stack></adw-bin>
                 </gtk-stack></adw-toast-overlay></gtk-overlay>`,
            );
            await new Promise((resolve) => requestAnimationFrame(resolve));
            for (const sel of ['adw-toast-overlay', 'gtk-stack', '#b', '#v']) {
                expect(box(sel).width).toBe(400);
                expect(box(sel).height).toBe(300);
            }
            host.remove();
        });
    });
};
