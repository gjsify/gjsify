import type { Canvas2DBridgeElement } from '@gjsify/adwaita-web/canvas2d';

export type Ready = Parameters<Canvas2DBridgeElement['onReady']>[0];
export type Frame = Parameters<Canvas2DBridgeElement['requestAnimationFrame']>[0];
