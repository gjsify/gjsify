// Adapted from https://codepen.io/linrock/pen/nMadjQ ("Falling Confetti" by linrock)
// Original: MIT license. Ported from CoffeeScript to TypeScript for gjsify.

const NUM_CONFETTI = 350;
const COLORS: [number, number, number][] = [
    [85, 71, 106],
    [174, 61, 99],
    [219, 56, 83],
    [244, 92, 68],
    [248, 182, 70],
];
const PI_2 = 2 * Math.PI;

function range(a: number, b: number): number {
    return (b - a) * Math.random() + a;
}

class Confetti {
    style: [number, number, number];
    rgb: string;
    r: number;
    r2: number;
    opacity = 0;
    dop = 0;
    x = 0;
    y = 0;
    xmax = 0;
    ymax = 0;
    vx = 0;
    vy = 0;

    constructor(
        private w: number,
        private h: number,
        private getWind: () => number,
    ) {
        this.style = COLORS[~~range(0, 5)];
        this.rgb = `rgba(${this.style[0]},${this.style[1]},${this.style[2]}`;
        this.r = ~~range(2, 6);
        this.r2 = 2 * this.r;
        this.replace();
    }

    replace(): void {
        this.opacity = 0;
        this.dop = 0.03 * range(1, 4);
        this.x = range(-this.r2, this.w - this.r2);
        this.y = range(-20, this.h - this.r2);
        this.xmax = this.w - this.r;
        this.ymax = this.h - this.r;
        this.vx = range(0, 2) + 8 * this.getWind() - 5;
        this.vy = 0.7 * this.r + range(-1, 1);
    }

    draw(ctx: CanvasRenderingContext2D): void {
        this.x += this.vx;
        this.y += this.vy;
        this.opacity += this.dop;
        if (this.opacity > 1) {
            this.opacity = 1;
            this.dop *= -1;
        }
        if (this.opacity < 0 || this.y > this.ymax) {
            this.replace();
        }
        if (this.x < 0 || this.x > this.xmax) {
            this.x = ((this.x % this.xmax) + this.xmax) % this.xmax;
        }

        ctx.beginPath();
        ctx.arc(~~this.x, ~~this.y, this.r, 0, PI_2, false);
        ctx.fillStyle = `${this.rgb},${this.opacity})`;
        ctx.fill();
    }

    /** Update dimensions when canvas resizes. */
    resize(w: number, h: number): void {
        this.w = w;
        this.h = h;
        this.xmax = w - this.r;
        this.ymax = h - this.r;
    }
}

/**
 * Start the falling confetti animation on the given canvas.
 * Works both in browser and GJS (uses globalThis.requestAnimationFrame).
 */
export function start(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    let w = canvas.width;
    let h = canvas.height;

    // Wind direction driven by mouse position (0..1 range, centered at 0.5)
    // Falls back to gentle sine wave when no mouse input
    let xpos = 0.5;
    let hasMouse = false;
    let time = 0;

    canvas.addEventListener('mousemove', (e: any) => {
        hasMouse = true;
        xpos = w > 0 ? e.clientX / w : 0.5;
    });

    const getWind = () => hasMouse ? xpos : 0.5 + 0.3 * Math.sin(time * 0.001);

    // Create confetti particles
    const confetti: Confetti[] = [];
    for (let i = 0; i < NUM_CONFETTI; i++) {
        confetti.push(new Confetti(w, h, getWind));
    }

    function step(): void {
        requestAnimationFrame(step);
        time++;

        // Handle resize
        const newW = canvas.width;
        const newH = canvas.height;
        if (newW !== w || newH !== h) {
            w = newW;
            h = newH;
            for (const c of confetti) c.resize(w, h);
        }

        ctx.clearRect(0, 0, w, h);
        for (const c of confetti) {
            c.draw(ctx);
        }
    }

    step();
}
