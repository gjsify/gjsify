export function startAnimation(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let t = 0;
    const loop = () => {
        const { width, height } = canvas;
        ctx.fillStyle = '#1e1e2e';
        ctx.fillRect(0, 0, width, height);

        const cx = width / 2 + Math.cos(t * 0.02) * (width / 3);
        const cy = height / 2 + Math.sin(t * 0.03) * (height / 3);

        const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 120);
        grad.addColorStop(0, '#f5c2e7');
        grad.addColorStop(1, 'rgba(245, 194, 231, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, 120, 0, Math.PI * 2);
        ctx.fill();

        t++;
        requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
}
