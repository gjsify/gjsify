// CANVAS2D_VECTORS against `<gjsify-canvas2d-bridge>` in a real browser: the canvas is a real
// `<canvas>` and `getContext('2d')` is the browser's own context.

import { describe, expect, it } from '@gjsify/unit';

import { type Canvas2DBridgeLike, driveCanvas2DVectors } from './conformance.js';
import { Canvas2DBridge } from './browser.js';

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export default async () => {
    const elements: HTMLElement[] = [];

    await driveCanvas2DVectors(
        {
            name: 'browser (<canvas>)',
            create() {
                const element = document.createElement('gjsify-canvas2d-bridge');
                document.body.appendChild(element);
                elements.push(element);
                return element as unknown as Canvas2DBridgeLike;
            },
            async allocate(bridge, width, height) {
                const element = bridge as unknown as HTMLElement;
                element.style.width = `${width}px`;
                element.style.height = `${height}px`;
                for (let i = 0; i < 20; i++) {
                    await frame();
                    if (bridge.canvas?.width === width && bridge.canvas?.height === height) break;
                }
                await frame();
                await frame();
            },
        },
        { describe, it, expect },
    );

    await describe('@gjsify/canvas2d in the browser', async () => {
        await it('exports the adwaita-web element as Canvas2DBridge', async () => {
            expect(Canvas2DBridge).toBe(customElements.get('gjsify-canvas2d-bridge'));
        });

        await it("hands out the browser's own 2d context", async () => {
            const element = document.createElement('gjsify-canvas2d-bridge') as unknown as Canvas2DBridgeLike &
                HTMLElement;
            element.style.width = '4px';
            element.style.height = '4px';
            document.body.appendChild(element);
            for (let i = 0; i < 20 && !element.canvas; i++) await frame();
            expect(element.getContext('2d') instanceof CanvasRenderingContext2D).toBe(true);
            element.remove();
        });
    });

    for (const element of elements) element.remove();
};
