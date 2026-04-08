// Canvas 2D state stack tests — save/restore must round-trip every
// state field (fillStyle, strokeStyle, globalAlpha, lineWidth, transform,
// text properties, clip region, imageSmoothingEnabled).
//
// Ported from refs/wpt/html/canvas/element/the-canvas-state/
//   2d.state.saverestore.{fillStyle,strokeStyle,globalAlpha,
//   globalCompositeOperation,lineWidth,lineCap,lineJoin,miterLimit,
//   transformation,path,underflow,clip,stackdepth}.html
// Original: Copyright (c) Web Platform Tests contributors. 3-Clause BSD.
// Reimplemented for GJS using @gjsify/canvas2d-core + @gjsify/unit.

import { describe, it, expect } from '@gjsify/unit';
import { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';

function makeCtx(width = 50, height = 50): CanvasRenderingContext2D {
    const canvas = { width, height };
    return new CanvasRenderingContext2D(canvas);
}

function nearlyEqual(a: number, b: number, eps = 1e-9): boolean {
    return Math.abs(a - b) < eps;
}

export default async () => {
    await describe('CanvasRenderingContext2D — state save/restore', async () => {

        await describe('style properties', async () => {
            await it('save/restore round-trips fillStyle string colors', async () => {
                const ctx = makeCtx();
                ctx.fillStyle = '#ff0000';
                ctx.save();
                ctx.fillStyle = '#00ff00';
                expect(ctx.fillStyle).toBe('#00ff00');
                ctx.restore();
                expect(ctx.fillStyle).toBe('#ff0000');
            });

            await it('save/restore round-trips strokeStyle', async () => {
                const ctx = makeCtx();
                ctx.strokeStyle = '#112233';
                ctx.save();
                ctx.strokeStyle = '#445566';
                ctx.restore();
                expect(ctx.strokeStyle).toBe('#112233');
            });

            await it('save/restore round-trips globalAlpha', async () => {
                const ctx = makeCtx();
                ctx.globalAlpha = 0.3;
                ctx.save();
                ctx.globalAlpha = 0.9;
                ctx.restore();
                expect(nearlyEqual(ctx.globalAlpha, 0.3)).toBe(true);
            });

            await it('save/restore round-trips globalCompositeOperation', async () => {
                const ctx = makeCtx();
                ctx.globalCompositeOperation = 'source-over';
                ctx.save();
                ctx.globalCompositeOperation = 'destination-over';
                ctx.restore();
                expect(ctx.globalCompositeOperation).toBe('source-over');
            });
        });

        await describe('line properties', async () => {
            await it('save/restore round-trips lineWidth', async () => {
                const ctx = makeCtx();
                ctx.lineWidth = 3;
                ctx.save();
                ctx.lineWidth = 10;
                ctx.restore();
                expect(ctx.lineWidth).toBe(3);
            });

            await it('save/restore round-trips lineCap and lineJoin', async () => {
                const ctx = makeCtx();
                ctx.lineCap = 'round';
                ctx.lineJoin = 'bevel';
                ctx.save();
                ctx.lineCap = 'square';
                ctx.lineJoin = 'miter';
                ctx.restore();
                expect(ctx.lineCap).toBe('round');
                expect(ctx.lineJoin).toBe('bevel');
            });

            await it('save/restore round-trips miterLimit', async () => {
                const ctx = makeCtx();
                ctx.miterLimit = 5;
                ctx.save();
                ctx.miterLimit = 20;
                ctx.restore();
                expect(ctx.miterLimit).toBe(5);
            });

            await it('save/restore round-trips lineDash and lineDashOffset', async () => {
                const ctx = makeCtx();
                ctx.setLineDash([5, 2]);
                ctx.lineDashOffset = 3;
                ctx.save();
                ctx.setLineDash([10, 10]);
                ctx.lineDashOffset = 7;
                ctx.restore();
                const restored = ctx.getLineDash();
                expect(restored.length).toBe(2);
                expect(restored[0]).toBe(5);
                expect(restored[1]).toBe(2);
                expect(ctx.lineDashOffset).toBe(3);
            });
        });

        await describe('text properties', async () => {
            await it('save/restore round-trips font, textAlign, textBaseline', async () => {
                const ctx = makeCtx();
                ctx.font = 'bold 20px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.save();
                ctx.font = '10px serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.restore();
                expect(ctx.font).toBe('bold 20px sans-serif');
                expect(ctx.textAlign).toBe('center');
                expect(ctx.textBaseline).toBe('middle');
            });
        });

        await describe('shadow properties', async () => {
            await it('save/restore round-trips shadow state', async () => {
                const ctx = makeCtx();
                ctx.shadowColor = '#abcdef';
                ctx.shadowBlur = 5;
                ctx.shadowOffsetX = 3;
                ctx.shadowOffsetY = 7;
                ctx.save();
                ctx.shadowColor = '#000000';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
                ctx.restore();
                expect(ctx.shadowColor).toBe('#abcdef');
                expect(ctx.shadowBlur).toBe(5);
                expect(ctx.shadowOffsetX).toBe(3);
                expect(ctx.shadowOffsetY).toBe(7);
            });
        });

        await describe('imageSmoothing properties — Excalibur pixel-art regression', async () => {
            // Locks the Phase D imageSmoothingEnabled=false fix. If any
            // future refactor drops imageSmoothingEnabled from cloneState,
            // save/restore would silently reset it to the default (true)
            // and pixel-art sprites would render blurry again.
            await it('save/restore round-trips imageSmoothingEnabled', async () => {
                const ctx = makeCtx();
                ctx.imageSmoothingEnabled = false;
                ctx.save();
                ctx.imageSmoothingEnabled = true;
                ctx.restore();
                expect(ctx.imageSmoothingEnabled).toBe(false);
            });

            await it('save/restore round-trips imageSmoothingQuality', async () => {
                const ctx = makeCtx();
                ctx.imageSmoothingQuality = 'high';
                ctx.save();
                ctx.imageSmoothingQuality = 'low';
                ctx.restore();
                expect(ctx.imageSmoothingQuality).toBe('high');
            });
        });

        await describe('transform matrix', async () => {
            await it('save/restore round-trips translation', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 20);
                ctx.save();
                ctx.translate(50, 50);
                const inner = ctx.getTransform();
                expect(nearlyEqual(inner.e, 60)).toBe(true);
                expect(nearlyEqual(inner.f, 70)).toBe(true);
                ctx.restore();
                const outer = ctx.getTransform();
                expect(nearlyEqual(outer.e, 10)).toBe(true);
                expect(nearlyEqual(outer.f, 20)).toBe(true);
            });

            await it('save/restore round-trips scale', async () => {
                const ctx = makeCtx();
                ctx.scale(2, 3);
                ctx.save();
                ctx.scale(5, 5);
                ctx.restore();
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 2)).toBe(true);
                expect(nearlyEqual(m.d, 3)).toBe(true);
            });
        });

        await describe('nested save/restore stacks', async () => {
            await it('triple save + triple restore returns to default', async () => {
                const ctx = makeCtx();
                ctx.save();
                ctx.fillStyle = '#111111';
                ctx.save();
                ctx.fillStyle = '#222222';
                ctx.save();
                ctx.fillStyle = '#333333';
                ctx.restore();
                expect(ctx.fillStyle).toBe('#222222');
                ctx.restore();
                expect(ctx.fillStyle).toBe('#111111');
                ctx.restore();
                // Default fillStyle per spec is #000000
                expect(ctx.fillStyle).toBe('#000000');
            });

            await it('restore() on empty stack is a no-op', async () => {
                const ctx = makeCtx();
                // Should not throw — Canvas 2D spec explicitly allows
                // unbalanced restores.
                expect(() => {
                    ctx.restore();
                    ctx.restore();
                    ctx.restore();
                }).not.toThrow();
            });

            await it('deep stack (50 saves) restores correctly', async () => {
                const ctx = makeCtx();
                const fills: string[] = [];
                for (let i = 0; i < 50; i++) {
                    ctx.save();
                    ctx.fillStyle = '#' + (i * 7).toString(16).padStart(6, '0');
                    fills.push(ctx.fillStyle as string);
                }
                for (let i = 49; i >= 0; i--) {
                    expect(ctx.fillStyle).toBe(fills[i]);
                    ctx.restore();
                }
            });
        });
    });
};
