import { Canvas2DBridge } from '@gjsify/canvas2d';

const draw = (_canvas: HTMLCanvasElement): void => {};

new Canvas2DBridge().onReady((canvas) => draw(canvas));

import { DOMException } from '@gjsify/dom-exception';

const fail = (_e: globalThis.DOMException): void => {};
fail(new DOMException('x', 'AbortError'));
