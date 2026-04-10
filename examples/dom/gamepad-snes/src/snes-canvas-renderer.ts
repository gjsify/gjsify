// SNES Controller — Canvas 2D renderer
// Draws the SNES controller on a canvas, highlighting active buttons.
// Platform-agnostic: works with browser <canvas> and GJS Canvas2DWidget.

import type { GamepadState } from './snes-controller.js';

const HIGHLIGHT_COLOR = '#ffdd00';

/** Button geometry for the SNES controller. */
interface ButtonDef {
    id: string;
    type: 'circle' | 'rect' | 'dpad-arrow' | 'line';
    color: string;
    x: number; y: number;
    // circle
    r?: number;
    // rect
    w?: number; h?: number; rx?: number;
    // dpad-arrow: direction
    dir?: 'up' | 'down' | 'left' | 'right';
    // line (select/start)
    x2?: number; y2?: number;
}

/** Shoulder buttons — drawn BEHIND the controller body. */
const SHOULDER_BUTTONS: ButtonDef[] = [
    { id: 'button-l', type: 'rect', color: '#aaa', x: 25, y: 5, w: 60, h: 30, rx: 10 },
    { id: 'button-r', type: 'rect', color: '#aaa', x: 165, y: 5, w: 60, h: 30, rx: 10 },
];

/** Face/d-pad/meta buttons — drawn ON TOP of the controller body. */
const BUTTONS: ButtonDef[] = [
    // Face buttons
    { id: 'button-x', type: 'circle', color: '#000080', x: 200, y: 40, r: 10 },
    { id: 'button-y', type: 'circle', color: '#009922', x: 180, y: 60, r: 10 },
    { id: 'button-a', type: 'circle', color: '#cc0000', x: 222, y: 62, r: 10 },
    { id: 'button-b', type: 'circle', color: '#ccbb00', x: 202, y: 82, r: 10 },
    // Select / Start
    { id: 'button-select', type: 'line', color: '#444', x: 100, y: 70, x2: 110, y2: 60 },
    { id: 'button-start',  type: 'line', color: '#444', x: 125, y: 70, x2: 135, y2: 60 },
    // D-pad arrows
    { id: 'button-up',    type: 'dpad-arrow', color: '#333', x: 50, y: 46, dir: 'up' },
    { id: 'button-down',  type: 'dpad-arrow', color: '#333', x: 50, y: 74, dir: 'down' },
    { id: 'button-left',  type: 'dpad-arrow', color: '#333', x: 36, y: 60, dir: 'left' },
    { id: 'button-right', type: 'dpad-arrow', color: '#333', x: 64, y: 60, dir: 'right' },
];

/** Button label definitions. */
const LABELS: { text: string; x: number; y: number; color: string; size: number }[] = [
    { text: 'X', x: 215, y: 32, color: '#cfcfcd', size: 8 },
    { text: 'A', x: 235, y: 51, color: '#cfcfcd', size: 8 },
    { text: 'Y', x: 167, y: 77, color: '#cfcfcd', size: 8 },
    { text: 'B', x: 190, y: 99, color: '#cfcfcd', size: 8 },
    { text: 'START',  x: 130, y: 82, color: '#999', size: 6 },
    { text: 'SELECT', x: 105, y: 82, color: '#999', size: 6 },
];

/**
 * Renders the SNES controller and info panel onto a canvas.
 * Call this every frame with the current gamepad state.
 */
export function renderSnesController(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: GamepadState | null,
): void {
    ctx.clearRect(0, 0, width, height);

    // Dark background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Scale and center the controller (SVG viewBox is 250x110)
    const controllerW = 250;
    const controllerH = 110;
    const infoHeight = 120;
    const availH = height - infoHeight;
    const scale = Math.min((width * 0.8) / controllerW, (availH * 0.7) / controllerH);
    const ox = (width - controllerW * scale) / 2;
    const oy = (availH - controllerH * scale) / 2;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // Shoulder buttons behind the body
    drawButtons(ctx, SHOULDER_BUTTONS, state?.activeButtons ?? new Set());
    drawControllerBody(ctx);
    // Face/d-pad/meta buttons on top
    drawButtons(ctx, BUTTONS, state?.activeButtons ?? new Set());
    drawLabels(ctx);

    ctx.restore();

    // Title
    ctx.fillStyle = '#888';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SNES Gamepad Tester', width / 2, 24);

    // Info panel at bottom
    if (state) {
        drawInfoPanel(ctx, width, height, infoHeight, state);
    } else {
        // "Connect your gamepad" message
        ctx.fillStyle = '#888';
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Connect your gamepad and press any button...', width / 2, height - infoHeight / 2);
    }
}

function drawControllerBody(ctx: CanvasRenderingContext2D): void {
    // Main body
    ctx.fillStyle = '#cfcfcd';
    ctx.fillRect(50, 10, 150, 90);

    // Left wing
    ctx.beginPath();
    ctx.arc(50, 60, 50, 0, Math.PI * 2);
    ctx.fill();

    // Right wing
    ctx.beginPath();
    ctx.arc(200, 60, 50, 0, Math.PI * 2);
    ctx.fill();

    // Right button area background
    ctx.fillStyle = '#a5a7a4';
    ctx.beginPath();
    ctx.arc(200, 60, 45, 0, Math.PI * 2);
    ctx.fill();

    // D-pad area background
    ctx.fillStyle = '#c8c8c8';
    ctx.beginPath();
    ctx.arc(50, 60, 28, 0, Math.PI * 2);
    ctx.fill();

    // Button stems (decorative)
    ctx.strokeStyle = '#cfcfcd';
    ctx.fillStyle = '#cfcfcd';
    ctx.lineWidth = 25;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(180, 60); ctx.lineTo(200, 40);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(202, 82); ctx.lineTo(222, 62);
    ctx.stroke();

    // D-pad cross
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.moveTo(43, 53); ctx.lineTo(43, 39); ctx.lineTo(57, 39); ctx.lineTo(57, 53);
    ctx.lineTo(71, 53); ctx.lineTo(71, 67); ctx.lineTo(57, 67); ctx.lineTo(57, 81);
    ctx.lineTo(43, 81); ctx.lineTo(43, 67); ctx.lineTo(29, 67); ctx.lineTo(29, 53);
    ctx.closePath();
    ctx.fill();

    // D-pad center dot
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(50, 60, 3, 0, Math.PI * 2);
    ctx.fill();
}

function drawButtons(ctx: CanvasRenderingContext2D, buttons: ButtonDef[], active: Set<string>): void {
    for (const btn of buttons) {
        const isActive = active.has(btn.id);
        const color = isActive ? HIGHLIGHT_COLOR : btn.color;

        switch (btn.type) {
            case 'circle':
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(btn.x, btn.y, btn.r!, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'rect':
                ctx.fillStyle = color;
                roundRect(ctx, btn.x, btn.y, btn.w!, btn.h!, btn.rx ?? 0);
                ctx.fill();
                break;

            case 'line':
                ctx.strokeStyle = color;
                ctx.lineWidth = 5;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(btn.x, btn.y);
                ctx.lineTo(btn.x2!, btn.y2!);
                ctx.stroke();
                break;

            case 'dpad-arrow':
                ctx.fillStyle = color;
                drawArrow(ctx, btn.x, btn.y, btn.dir!);
                break;
        }
    }
}

function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: string): void {
    ctx.beginPath();
    switch (dir) {
        case 'up':
            ctx.moveTo(cx - 5, cy + 5); ctx.lineTo(cx, cy - 5); ctx.lineTo(cx + 5, cy + 5);
            break;
        case 'down':
            ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx + 5, cy - 5);
            break;
        case 'left':
            ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy); ctx.lineTo(cx + 5, cy + 5);
            break;
        case 'right':
            ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy); ctx.lineTo(cx - 5, cy + 5);
            break;
    }
    ctx.closePath();
    ctx.fill();
}

function drawLabels(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const label of LABELS) {
        ctx.fillStyle = label.color;
        ctx.font = `${label.size}px Arial, sans-serif`;
        ctx.fillText(label.text, label.x, label.y);
    }
}

function drawInfoPanel(
    ctx: CanvasRenderingContext2D,
    width: number, height: number,
    panelH: number,
    state: GamepadState,
): void {
    const y0 = height - panelH + 10;
    const lineH = 16;
    const labelX = width / 2 - 160;
    const valueX = width / 2 - 90;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const rows: [string, string, string?][] = [
        ['Name', state.id],
        ['Index', String(state.index), `Mapping: ${state.mapping}`],
        ['Buttons', String(state.buttons.length), `Axes: ${state.axes.length}`],
        ['Pressed', state.pressedButtons.length > 0 ? state.pressedButtons.join(', ') : '--'],
        ['Axes', state.axes.map((v, i) => `${i}:${v >= 0 ? '+' : ''}${v.toFixed(2)}`).join('  ')],
        ['Timestamp', state.timestamp.toFixed(1) + ' ms'],
    ];

    for (let i = 0; i < rows.length; i++) {
        const y = y0 + i * lineH;
        const [label, value, extra] = rows[i];

        // Label
        ctx.fillStyle = '#666';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(label, labelX, y);

        // Value
        ctx.fillStyle = label === 'Name' ? '#ddd' : label === 'Pressed' ? HIGHLIGHT_COLOR : '#aaa';
        ctx.font = label === 'Axes' || label === 'Timestamp'
            ? '10px monospace' : '11px system-ui, sans-serif';
        ctx.fillText(value, valueX, y);

        // Extra column
        if (extra) {
            ctx.fillStyle = '#aaa';
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillText(extra, valueX + 180, y);
        }
    }
}

function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number,
): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
