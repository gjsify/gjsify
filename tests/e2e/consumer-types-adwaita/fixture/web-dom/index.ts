import { Canvas2DBridgeElement } from '@gjsify/adwaita-web/canvas2d';

const draw = (_canvas: HTMLCanvasElement, _ctx: CanvasRenderingContext2D): void => {};
const frame: FrameRequestCallback = () => {};

new Canvas2DBridgeElement().onReady(draw);
new Canvas2DBridgeElement().requestAnimationFrame(frame);
