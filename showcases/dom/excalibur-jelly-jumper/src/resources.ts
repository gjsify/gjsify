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
    showPlayButton() {
        return Promise.resolve();
    }
    draw() {}
    dispose() {}
}

/**
 * Make an `ex.Sound` non-fatal on runtimes where audio is unavailable.
 *
 * On the `--app node` reverse bridge the GStreamer audio path over
 * `@gjsify/node-gi` is not yet functional — a documented node-gi follow-up —
 * in TWO places:
 *   1. DECODE: `@gjsify/webaudio`'s `decodeAudioData` rejects, so `Sound.load()`
 *      rejects. Excalibur's `Loader` aborts the whole load on the first
 *      rejection, racing scene init ahead of the still-loading `TiledResource`
 *      (the level then has no `Player` and camera setup throws).
 *   2. PLAYBACK: even a "loaded" sound, when played, hits
 *      `AudioBufferSourceNode.start` → `new GstPlayer`, which node-gi rejects
 *      with an uncaught `Unsupported interface IN argument` (exit 1).
 *
 * So on decode failure we both (a) resolve the load (silent) — keeping the loader
 * waiting for the VISUAL resources so the game renders — and (b) neutralize
 * `play()` so the later `AudioManager` calls never reach the broken playback
 * pipeline. Audio simply stays silent.
 *
 * Platform-agnostic: on GJS and in the browser, where audio works, the `catch`
 * never fires — this is a no-op there.
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
