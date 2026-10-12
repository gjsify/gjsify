// The Canvas 2D subset (ADR 0107), driven through a recording backend: the semantics the Android
// driver inherits, held without a device.

import { describe, expect, it } from '@gjsify/unit';

import { type Canvas2DBackend, NsCanvas } from './canvas-subset.js';

class Recorder implements Canvas2DBackend {
    readonly calls: string[] = [];
    resize(w: number, h: number) { this.calls.push(`resize ${w}x${h}`); }
    fillRect(x: number, y: number, w: number, h: number, argb: number) { this.calls.push(`fillRect ${x},${y},${w},${h} ${(argb >>> 0).toString(16)}`); }
    clearRect(x: number, y: number, w: number, h: number) { this.calls.push(`clearRect ${x},${y},${w},${h}`); }
    resetPath() { this.calls.push('resetPath'); }
    moveTo(x: number, y: number) { this.calls.push(`moveTo ${x},${y}`); }
    lineTo(x: number, y: number) { this.calls.push(`lineTo ${x},${y}`); }
    rect(x: number, y: number, w: number, h: number) { this.calls.push(`rect ${x},${y},${w},${h}`); }
    closePath() { this.calls.push('closePath'); }
    fillPath(argb: number) { this.calls.push(`fillPath ${(argb >>> 0).toString(16)}`); }
    strokePath(argb: number, width: number) { this.calls.push(`strokePath ${(argb >>> 0).toString(16)} ${width}`); }
    setImageSmoothing(on: boolean) { this.calls.push(`smoothing ${on}`); }
    invalidate() {}
}

function setup() {
    const backend = new Recorder();
    const canvas = new NsCanvas(32, 32, backend);
    return { backend, canvas, ctx: canvas.getContext('2d')! };
}

export const Canvas2DSubsetNsTest = async () => {
    await describe('Canvas2D subset: surface', async () => {
        await it('allocates the surface at the logical size and reallocates on a size write', () => {
            const { backend, canvas } = setup();
            canvas.width = 64;
            expect(canvas.width).toBe(64);
            expect(JSON.stringify(backend.calls)).toBe(JSON.stringify(['resize 32x32', 'resize 64x32']));
        });

        await it('answers getContext("2d") with one context and anything else with null', () => {
            const { canvas, ctx } = setup();
            expect(canvas.getContext('2d')).toBe(ctx);
            expect(canvas.getContext('webgl')).toBeNull();
        });

        await it('delivers dispatched events to listeners until they are removed', () => {
            const { canvas } = setup();
            let heard = 0;
            const listener = () => { heard++; };
            canvas.addEventListener('resize', listener);
            canvas.dispatchEvent({ type: 'resize' });
            canvas.removeEventListener('resize', listener);
            canvas.dispatchEvent({ type: 'resize' });
            expect(heard).toBe(1);
        });
    });

    await describe('Canvas2D subset: state', async () => {
        await it('serialises colours the way the browser does', () => {
            const { ctx } = setup();
            ctx.fillStyle = 'red';
            expect(ctx.fillStyle).toBe('#ff0000');
            ctx.fillStyle = 'rgba(0, 0, 255, 0.5)';
            expect(ctx.fillStyle).toBe('rgba(0, 0, 255, 0.5)');
            ctx.strokeStyle = '#0f0';
            expect(ctx.strokeStyle).toBe('#00ff00');
        });

        await it('keeps the old style for a colour it cannot parse', () => {
            const { ctx } = setup();
            ctx.fillStyle = '#123456';
            ctx.fillStyle = 'not a colour';
            expect(ctx.fillStyle).toBe('#123456');
        });

        await it('refuses a gradient or pattern where a colour string is expected', () => {
            const { ctx } = setup();
            expect(() => { ctx.fillStyle = {} as unknown as string; }).toThrow('Canvas2D subset');
        });

        await it('ignores a non-positive lineWidth and an out-of-range globalAlpha', () => {
            const { ctx } = setup();
            ctx.lineWidth = 0;
            ctx.lineWidth = -3;
            ctx.globalAlpha = 2;
            expect(ctx.lineWidth).toBe(1);
            expect(ctx.globalAlpha).toBe(1);
            ctx.lineWidth = 4;
            ctx.globalAlpha = 0.5;
            expect(ctx.lineWidth).toBe(4);
            expect(ctx.globalAlpha).toBe(0.5);
        });

        await it('restores what save() kept, and ignores restore() on an empty stack', () => {
            const { backend, ctx } = setup();
            ctx.restore();
            ctx.fillStyle = '#ff0000';
            ctx.imageSmoothingEnabled = true;
            ctx.save();
            ctx.fillStyle = '#00ff00';
            ctx.imageSmoothingEnabled = false;
            ctx.restore();
            expect(ctx.fillStyle).toBe('#ff0000');
            expect(ctx.imageSmoothingEnabled).toBe(true);
            expect(backend.calls[backend.calls.length - 1]).toBe('smoothing true');
        });
    });

    await describe('Canvas2D subset: drawing', async () => {
        await it('fills a rectangle in the fill colour, with globalAlpha folded into alpha', () => {
            const { backend, ctx } = setup();
            ctx.fillStyle = '#ff8000';
            ctx.fillRect(1, 2, 3, 4);
            ctx.globalAlpha = 0.5;
            ctx.fillRect(0, 0, 1, 1);
            expect(JSON.stringify(backend.calls.slice(1))).toBe(JSON.stringify(['fillRect 1,2,3,4 ffff8000', 'fillRect 0,0,1,1 80ff8000']));
        });

        await it('normalises a negative size and skips an empty or non-finite rectangle', () => {
            const { backend, ctx } = setup();
            ctx.fillRect(10, 10, -4, -2);
            ctx.fillRect(0, 0, 0, 5);
            ctx.fillRect(NaN, 0, 1, 1);
            ctx.clearRect(5, 5, -5, 5);
            expect(JSON.stringify(backend.calls.slice(1))).toBe(JSON.stringify(['fillRect 6,8,4,2 ff000000', 'clearRect 0,5,5,5']));
        });

        await it('starts a subpath on a lineTo without a current point', () => {
            const { backend, ctx } = setup();
            ctx.beginPath();
            ctx.lineTo(3, 3);
            ctx.lineTo(4, 4);
            ctx.closePath();
            ctx.fill();
            expect(JSON.stringify(backend.calls.slice(1))).toBe(JSON.stringify(['resetPath', 'moveTo 3,3', 'lineTo 4,4', 'closePath', 'fillPath ff000000']));
        });

        await it('leaves the current point at the corner of a rect, as the spec does', () => {
            const { backend, ctx } = setup();
            ctx.beginPath();
            ctx.rect(1, 1, 5, 5);
            ctx.lineTo(9, 9);
            ctx.stroke();
            expect(JSON.stringify(backend.calls.slice(2))).toBe(JSON.stringify(['rect 1,1,5,5', 'moveTo 1,1', 'lineTo 9,9', 'strokePath ff000000 1']));
        });
    });

    await describe('Canvas2D subset: absent members', async () => {
        await it('has NO member outside the subset, so a call is a TypeError and not a silent no-op', () => {
            const { ctx } = setup();
            const absent = ['arc', 'drawImage', 'getImageData', 'putImageData', 'fillText', 'translate', 'scale',
                'rotate', 'setTransform', 'clip', 'createLinearGradient', 'bezierCurveTo', 'quadraticCurveTo',
                'measureText', 'strokeRect', 'isPointInPath'];
            for (const name of absent) {
                expect(name in ctx).toBe(false);
                expect(() => (ctx as unknown as Record<string, () => void>)[name]!()).toThrow();
            }
        });
    });
};
