// Browser entry point for canvas2d-fireworks showcase.

import { start } from '../fireworks.js';

/**
 * Mount the fireworks demo into a container element.
 * Creates a canvas, syncs its size with the container, and starts the animation.
 */
export function mount(container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    container.append(canvas);

    const sync = () => {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    };
    new ResizeObserver(sync).observe(container);
    sync();
    start(canvas);
}

// Auto-run for standalone mode (index.html with existing <canvas>)
const existing = document.getElementsByTagName('canvas')[0];
if (existing) {
    existing.width = window.innerWidth;
    existing.height = window.innerHeight;
    window.addEventListener('resize', () => {
        existing.width = window.innerWidth;
        existing.height = window.innerHeight;
    }, { passive: true });
    start(existing);
}
