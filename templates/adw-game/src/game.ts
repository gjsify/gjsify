import * as ex from 'excalibur';

export async function startGame(canvas: HTMLCanvasElement): Promise<ex.Engine> {
    const engine = new ex.Engine({
        canvasElement: canvas as unknown as HTMLCanvasElement,
        width: canvas.width,
        height: canvas.height,
        backgroundColor: ex.Color.fromHex('#1e1e2e'),
        suppressPlayButton: true,
    });

    const player = new ex.Actor({
        pos: ex.vec(canvas.width / 2, canvas.height / 2),
        width: 60,
        height: 60,
        color: ex.Color.fromHex('#89b4fa'),
    });
    player.actions.repeatForever((ctx) => {
        ctx.rotateBy(Math.PI, 1);
    });

    engine.add(player);
    await engine.start();
    return engine;
}
