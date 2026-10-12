import { Canvas2DBridge } from '@gjsify/canvas2d/browser';

const draw = (_canvas: HTMLCanvasElement): void => {};

new Canvas2DBridge().onReady((canvas) => draw(canvas));
