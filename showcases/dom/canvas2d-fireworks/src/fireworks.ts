// Adapted from https://codepen.io/juliangarnier/pen/gmOwJX ("Fireworks" by Julian Garnier)
// Original: MIT license. Reimplemented in TypeScript without anime.js for gjsify.

const DEFAULT_COLORS = ['#FF1461', '#18FF92', '#5A87FF', '#FBF38C'];

function random(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Exponential ease-out: fast start, slow finish. */
function easeOutExpo(t: number): number {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// --- Effect controller ------------------------------------------------------

export interface FireworksEffectController {
    /** Number of particles per burst. */
    particleCount: number;
    /** Milliseconds between automatic bursts. */
    autoInterval: number;
    /** Maximum radius of the expanding shock-wave circle. */
    maxBurstRadius: number;
    /** When true, automatic bursts keep firing near the center. */
    autoFireworks: boolean;
}

export const DEFAULT_CONTROLLER: FireworksEffectController = {
    particleCount: 30,
    autoInterval: 200,
    maxBurstRadius: 160,
    autoFireworks: true,
};

export interface FireworksDemo {
    readonly effectController: FireworksEffectController;
    /** Stop the animation loop. */
    stop(): void;
}

// --- Particle types ---------------------------------------------------------

interface Particule {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    color: string;
    startRadius: number;
}

interface Circle {
    x: number;
    y: number;
    targetRadius: number;
    alphaDuration: number;
}

interface Burst {
    startTime: number;
    duration: number;
    particules: Particule[];
    circle: Circle;
}

// --- Burst creation ---------------------------------------------------------

function createBurst(x: number, y: number, now: number, controller: FireworksEffectController): Burst {
    const particules: Particule[] = [];
    const count = Math.max(1, Math.floor(controller.particleCount));
    for (let i = 0; i < count; i++) {
        const angle = random(0, 360) * Math.PI / 180;
        const value = random(50, 180);
        const sign = [-1, 1][random(0, 1)];
        const dist = sign * value;
        particules.push({
            startX: x,
            startY: y,
            endX: x + dist * Math.cos(angle),
            endY: y + dist * Math.sin(angle),
            color: DEFAULT_COLORS[random(0, DEFAULT_COLORS.length - 1)],
            startRadius: random(16, 32),
        });
    }

    const maxR = Math.max(10, controller.maxBurstRadius);
    return {
        startTime: now,
        duration: random(1200, 1800),
        particules,
        circle: {
            x,
            y,
            targetRadius: random(Math.floor(maxR / 2), maxR),
            alphaDuration: random(600, 800),
        },
    };
}

// --- Drawing ----------------------------------------------------------------

function drawBurst(ctx: CanvasRenderingContext2D, burst: Burst, now: number): boolean {
    const elapsed = now - burst.startTime;
    const t = Math.min(elapsed / burst.duration, 1);
    const eased = easeOutExpo(t);

    // Draw particules
    for (const p of burst.particules) {
        const x = p.startX + (p.endX - p.startX) * eased;
        const y = p.startY + (p.endY - p.startY) * eased;
        const radius = p.startRadius + (0.1 - p.startRadius) * eased;
        if (radius > 0.05) {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI, true);
            ctx.fillStyle = p.color;
            ctx.fill();
        }
    }

    // Draw expanding circle
    const c = burst.circle;
    const circleRadius = 0.1 + (c.targetRadius - 0.1) * eased;
    const alphaT = Math.min(elapsed / c.alphaDuration, 1); // linear
    const alpha = 0.5 * (1 - alphaT);
    const lineWidth = 6 * (1 - eased);

    if (alpha > 0.01 && lineWidth > 0.01) {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(c.x, c.y, circleRadius, 0, 2 * Math.PI, true);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = '#FFF';
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // Return true if burst is still alive
    return t < 1;
}

// --- Main animation loop ----------------------------------------------------

/**
 * Start the fireworks animation on the given canvas.
 * Works both in browser and GJS (uses globalThis.requestAnimationFrame).
 * Returns a demo handle with a mutable effect controller.
 */
export function start(canvas: HTMLCanvasElement): FireworksDemo {
    const ctx = canvas.getContext('2d')!;
    let w = canvas.width;
    let h = canvas.height;

    const bursts: Burst[] = [];
    const effectController: FireworksEffectController = { ...DEFAULT_CONTROLLER };
    let lastAutoTime = 0;
    let running = true;

    canvas.addEventListener('mousedown', (e: any) => {
        const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        // Translate event coords into canvas-pixel coords (handles CSS scaling).
        const rect = canvas.getBoundingClientRect?.();
        const scaleX = rect && rect.width ? canvas.width / rect.width : 1;
        const scaleY = rect && rect.height ? canvas.height / rect.height : 1;
        const x = rect ? (e.clientX - rect.left) * scaleX : e.clientX;
        const y = rect ? (e.clientY - rect.top) * scaleY : e.clientY;
        bursts.push(createBurst(x, y, now, effectController));
    });

    function step(now: number): void {
        if (!running) return;
        requestAnimationFrame(step);

        // Handle resize
        const newW = canvas.width;
        const newH = canvas.height;
        if (newW !== w || newH !== h) {
            w = newW;
            h = newH;
        }

        // Clear canvas
        ctx.clearRect(0, 0, w, h);

        // Auto-fireworks near center when enabled
        if (effectController.autoFireworks) {
            if (lastAutoTime === 0) lastAutoTime = now;
            if (now - lastAutoTime >= effectController.autoInterval) {
                lastAutoTime = now;
                const cx = w / 2;
                const cy = h / 2;
                bursts.push(createBurst(
                    random(Math.floor(cx - 50), Math.floor(cx + 50)),
                    random(Math.floor(cy - 50), Math.floor(cy + 50)),
                    now,
                    effectController,
                ));
            }
        }

        // Draw all active bursts, remove finished ones
        for (let i = bursts.length - 1; i >= 0; i--) {
            if (!drawBurst(ctx, bursts[i], now)) {
                bursts.splice(i, 1);
            }
        }
    }

    requestAnimationFrame(step);

    return {
        effectController,
        stop() { running = false; },
    };
}
