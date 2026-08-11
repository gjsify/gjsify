import { TiledResource } from '@excaliburjs/plugin-tiled';
import * as ex from 'excalibur';

// Paths are root-relative: the browser serves them from dist/res/*, and on GJS the
// XHR/HTMLImageElement stubs resolve root-relative URLs against the program directory.
//
// `Resources` must stay a module-level constant. Actors call
// `SpriteSheet.fromImageSource({ image: Resources.img.X })` at module-load time and capture the
// reference, so anything that swaps `Resources` after import leaves them pointing at an unloaded
// ImageSource.

export const Resources = {
    img: {
        player: new ex.ImageSource('/res/images/Player.png'),
        level1Background: new ex.ImageSource('/res/images/Forest_Background_0.png'),
        spiderGreen: new ex.ImageSource('/res/images/Spider_1.png'),
        spiderGray: new ex.ImageSource('/res/images/Spider_2.png'),
        birdPurple: new ex.ImageSource('/res/images/Bird_1.png'),
        birdOrange: new ex.ImageSource('/res/images/Bird_2.png'),
        platform: new ex.ImageSource('/res/images/Platform.png'),
        bouncepadGreen: new ex.ImageSource('/res/images/Bouncepad_Green.png'),
        bouncepadRed: new ex.ImageSource('/res/images/Bouncepad_Red.png'),
        bouncepadWood: new ex.ImageSource('/res/images/Bouncepad_Wood.png'),
        axe: new ex.ImageSource('/res/images/Axe_Trap.png'),
        circularSaw: new ex.ImageSource('/res/images/Circular_Saw.png'),
        smokePuff: new ex.ImageSource('/res/images/Smoke_Puff.png'),
        smokeLand: new ex.ImageSource('/res/images/Smoke_Land.png'),
        coin: new ex.ImageSource('/res/images/Coin.png'),
        coinsUi: new ex.ImageSource('/res/images/Coins_Ui.png'),
    },
    fonts: {
        round: new ex.FontSource('/res/fonts/Round9x13.ttf', 'Round9x13', {
            filtering: ex.ImageFiltering.Pixel,
            quality: 4,
        }),
    },
    music: {
        stage1: new ex.Sound('/res/music/stage1.mp3'),
        stage2: new ex.Sound('/res/music/stage2.mp3'),
    },
    sfx: {
        jump: new ex.Sound('/res/sfx/jump.wav'),
        jumpSpring: new ex.Sound('/res/sfx/jump-spring.wav'),
        land: new ex.Sound('/res/sfx/land.wav'),
        turnAround: new ex.Sound('/res/sfx/turn-around.wav'),
        stomp: new ex.Sound('/res/sfx/stomp.wav'),
        damage: new ex.Sound('/res/sfx/damage.wav'),
        collectCoin: new ex.Sound('/res/sfx/coin.wav'),
    },
    tiled: {
        level1: new TiledResource('/res/tilemaps/level1.tmx', {
            useTilemapCameraStrategy: true,
        }),
    },
} as const;

// Starts the game as soon as loading finishes, with no play-button overlay.
class DevLoader extends ex.Loader {
    /**
     * Skips the whole "wait for the player" step, not just its button.
     *
     * `Loader.onUserAction()` is `delay(200, engine.clock)` then `showPlayButton()`, and overriding
     * only the button leaves the delay — which is scheduled on the EXCALIBUR CLOCK, advancing per
     * frame, with a spiral-of-death guard that clamps `elapsed` to 1 ms for any frame over 200 ms.
     * Below 5 fps the 200 ms cosmetic pause therefore becomes 200 FRAMES: at 1.1 s per frame on a
     * GPU-less macOS VM the loader sat for ~4 minutes, nothing drawn, nothing logged, `game.start()`
     * never resolving (gjsify#1107). Nothing here needs waiting for — the pause exists to let a
     * player watch a progress bar finish, and this loader draws none.
     */
    onUserAction() {
        return Promise.resolve();
    }
    showPlayButton() {
        return Promise.resolve();
    }
    draw() {}
    dispose() {}
}

/**
 * Makes an `ex.Sound` non-fatal when the HOST cannot decode or play it — a missing codec plugin, no
 * audio sink, a container with no sound device. Not a runtime fallback: `@gjsify/webaudio`'s
 * GStreamer decode and playback work on gjs and on all three reverse-bridge runtimes, so where audio
 * works the `catch` never fires.
 *
 * Needed because Excalibur's `Loader` aborts the WHOLE load on the first rejection, and a rejected
 * `Sound.load()` races scene init ahead of the still-loading `TiledResource`, leaving the level with
 * no `Player` for the camera to follow. So failure resolves the load (the loader keeps waiting for
 * the VISUAL resources, and the game renders) and neutralizes `play()`, since later `AudioManager`
 * calls must not reach a pipeline that was never built. Silent beats not running.
 */
function tolerateAudioFailure(sound: ex.Sound): ex.Sound {
    const load = sound.load.bind(sound);
    sound.load = (() =>
        load().catch((err: unknown) => {
            console.warn('[jelly-jumper] audio unavailable on this runtime; continuing silent:', err);
            sound.play = () => Promise.resolve(true);
            return sound.data;
        })) as ex.Sound['load'];
    return sound;
}

export const loader: ex.Loader = new DevLoader();
for (const group of Object.values(Resources)) {
    for (const resource of Object.values(group)) {
        const loadable = resource as ex.Loadable<unknown>;
        loader.addResource(loadable instanceof ex.Sound ? tolerateAudioFailure(loadable) : loadable);
    }
}
