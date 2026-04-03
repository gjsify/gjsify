// Canvas 2D Text Baseline Visual Demo
// Renders all six CSS textBaseline values with a red guide line at the exact y-coordinate.
// Usable in both GJS (Cairo/PangoCairo) and browser — visual comparison tool.

export const DEFAULT_WIDTH = 620;
export const DEFAULT_HEIGHT = 400;

const BASELINES: CanvasTextBaseline[] = [
    'top',
    'hanging',
    'middle',
    'alphabetic',
    'ideographic',
    'bottom',
];

/**
 * Render the baseline comparison demo onto the given canvas.
 * Uses canvas.width / canvas.height — works identically in GJS and browser.
 * Call this whenever the canvas size changes to get a responsive re-render.
 */
export function renderDemo(canvas: HTMLCanvasElement): void {
    const W = canvas.width;
    const H = canvas.height;
    if (W <= 0 || H <= 0) return;

    const ctx = canvas.getContext('2d')!;

    const rowHeight = H / BASELINES.length;
    const fontSize = Math.max(16, Math.round(rowHeight * 0.55));
    const labelX = Math.round(W * 0.72);
    const textX = 10;

    // Background
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, W, H);

    // Horizontal separator lines between rows
    ctx.strokeStyle = '#dee2e6';
    ctx.lineWidth = 1;
    for (let i = 1; i < BASELINES.length; i++) {
        const sepY = Math.round(i * rowHeight);
        ctx.beginPath();
        ctx.moveTo(0, sepY);
        ctx.lineTo(W, sepY);
        ctx.stroke();
    }

    // Vertical separator before labels
    ctx.beginPath();
    ctx.moveTo(labelX - 10, 0);
    ctx.lineTo(labelX - 10, H);
    ctx.stroke();

    BASELINES.forEach((baseline, i) => {
        const centerY = (i + 0.5) * rowHeight;

        // Red guide line at the exact y passed to fillText
        ctx.strokeStyle = '#e63946';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(labelX - 10, centerY);
        ctx.stroke();

        // Text in dark blue
        ctx.fillStyle = '#1d3557';
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textBaseline = baseline;
        ctx.textAlign = 'left';
        ctx.fillText('Gjsify', textX, centerY);

        // Label: textBaseline name
        const labelFontSize = Math.max(10, Math.round(rowHeight * 0.21));
        ctx.fillStyle = '#457b9d';
        ctx.font = `${labelFontSize}px monospace`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(`textBaseline='${baseline}'`, labelX, centerY);

        // Small dot at the exact anchor point
        ctx.fillStyle = '#e63946';
        ctx.beginPath();
        ctx.arc(textX - 4, centerY, 3, 0, Math.PI * 2);
        ctx.fill();
    });

    // Title
    const titleFontSize = Math.max(9, Math.round(H * 0.032));
    ctx.fillStyle = '#1d3557';
    ctx.font = `bold ${titleFontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillText('Red line = y passed to fillText  ●  Red dot = anchor point', W - 8, 4);
}
