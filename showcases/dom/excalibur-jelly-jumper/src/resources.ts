import { TiledResource } from '@excaliburjs/plugin-tiled';
import * as ex from 'excalibur';

// All resources use root-relative paths. The browser serves assets from
// dist/res/* via http-server. For GJS, the XHR/HTMLImageElement stubs
// resolve root-relative URLs against the program directory.
//
// NOTE: Module-level `Resources` is intentional — actors like player.ts,
// bird.ts, spider.ts, bouncepad.ts, moving-platform.ts, smoke.ts call
// `SpriteSheet.fromImageSource({ image: Resources.img.X })` at module load
// time, capturing references. Any factory that swaps `Resources` after
// import breaks those captured references → "ImageSource not yet loaded"
// warnings at runtime.

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

// DevLoader starts the game immediately once loading completes, skipping
// Excalibur's play button overlay (which we replace with Excalibur's own
// suppressPlayButton: false for the audio-unlock user gesture).
class DevLoader extends ex.Loader {
    /**
     * Skip the whole "wait for the player" step, not just its button.
     *
     * `Loader.onUserAction()` is `delay(200, engine.clock)` followed by
     * `showPlayButton()`. Overriding only the button left the delay, and that
     * delay is scheduled on the EXCALIBUR CLOCK, whose time advances per frame
     * rather than per millisecond — with a spiral-of-death guard that clamps
     * `elapsed` to 1 ms for ANY frame that took longer than 200 ms. So on a host
     * slower than 5 fps a 200 ms cosmetic pause silently becomes 200 FRAMES:
     * measured at 1.1 s per frame on a GPU-less macOS VM, the loader sat there
     * for ~4 minutes with nothing drawn, nothing rejected and nothing logged —
     * the window looked frozen, and `game.start()` simply never resolved
     * (gjsify#1107).
     *
     * There is nothing to wait for here: the pause exists to let a player see
     * the progress bar finish, and this loader draws no progress bar. Removing
     * it makes loading depend on the resources alone, on every host.
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
 * Make an `ex.Sound` non-fatal when the host cannot decode or play it.
 *
 * Audio is NOT a GJS-only capability here: `@gjsify/webaudio`'s GStreamer decode
 * (`decodebin`) and playback (`autoaudiosink`) run on gjs AND on the `--app node`
 * reverse bridge — node, bun and deno alike, verified against PipeWire rather
 * than against the absence of an error. So this wrapper is a fallback for a HOST
 * that lacks the pieces (no `gst-plugins-good/bad` for the codec, no audio sink,
 * a container with no sound device), not for a runtime.
 *
 * It exists because Excalibur's `Loader` aborts the WHOLE load on the first
 * resource rejection: a `Sound.load()` that rejects races scene init ahead of the
 * still-loading `TiledResource`, and the level then has no `Player` for camera
 * setup to follow. So on failure we both (a) resolve the load, keeping the loader
 * waiting for the VISUAL resources so the game still renders, and (b) neutralize
 * `play()` so later `AudioManager` calls cannot reach a pipeline that was never
 * built. The game runs silent instead of not running.
 *
 * Platform-agnostic: wherever audio works — gjs, the reverse-bridge runtimes, the
 * browser — the `catch` never fires and this is a no-op.
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
