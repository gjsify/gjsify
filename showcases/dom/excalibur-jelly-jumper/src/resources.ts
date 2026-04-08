import { TiledResource } from '@excaliburjs/plugin-tiled'
import * as ex from 'excalibur'

// ---------------------------------------------------------------------------
// Factory functions — used by src/game.ts (both GJS and browser entries)
// ---------------------------------------------------------------------------

export function createResources(baseUrl: string) {
  return {
    img: {
      player: new ex.ImageSource(baseUrl + '/res/images/Player.png'),
      level1Background: new ex.ImageSource(baseUrl + '/res/images/Forest_Background_0.png'),
      spiderGreen: new ex.ImageSource(baseUrl + '/res/images/Spider_1.png'),
      spiderGray: new ex.ImageSource(baseUrl + '/res/images/Spider_2.png'),
      birdPurple: new ex.ImageSource(baseUrl + '/res/images/Bird_1.png'),
      birdOrange: new ex.ImageSource(baseUrl + '/res/images/Bird_2.png'),
      platform: new ex.ImageSource(baseUrl + '/res/images/Platform.png'),
      bouncepadGreen: new ex.ImageSource(baseUrl + '/res/images/Bouncepad_Green.png'),
      bouncepadRed: new ex.ImageSource(baseUrl + '/res/images/Bouncepad_Red.png'),
      bouncepadWood: new ex.ImageSource(baseUrl + '/res/images/Bouncepad_Wood.png'),
      axe: new ex.ImageSource(baseUrl + '/res/images/Axe_Trap.png'),
      circularSaw: new ex.ImageSource(baseUrl + '/res/images/Circular_Saw.png'),
      smokePuff: new ex.ImageSource(baseUrl + '/res/images/Smoke_Puff.png'),
      smokeLand: new ex.ImageSource(baseUrl + '/res/images/Smoke_Land.png'),
      coin: new ex.ImageSource(baseUrl + '/res/images/Coin.png'),
      coinsUi: new ex.ImageSource(baseUrl + '/res/images/Coins_Ui.png'),
    },
    fonts: {
      round: new ex.FontSource(baseUrl + '/res/fonts/Round9x13.ttf', 'Round9x13', {
        filtering: ex.ImageFiltering.Pixel,
        quality: 4,
      }),
    },
    music: {
      stage1: new ex.Sound(baseUrl + '/res/music/stage1.mp3'),
      stage2: new ex.Sound(baseUrl + '/res/music/stage2.mp3'),
    },
    sfx: {
      jump: new ex.Sound(baseUrl + '/res/sfx/jump.wav'),
      jumpSpring: new ex.Sound(baseUrl + '/res/sfx/jump-spring.wav'),
      land: new ex.Sound(baseUrl + '/res/sfx/land.wav'),
      turnAround: new ex.Sound(baseUrl + '/res/sfx/turn-around.wav'),
      stomp: new ex.Sound(baseUrl + '/res/sfx/stomp.wav'),
      damage: new ex.Sound(baseUrl + '/res/sfx/damage.wav'),
      collectCoin: new ex.Sound(baseUrl + '/res/sfx/coin.wav'),
    },
    tiled: {
      level1: new TiledResource(baseUrl + '/res/tilemaps/level1.tmx', {
        useTilemapCameraStrategy: true,
      }),
    },
  } as const
}

// instantly starts game once loading has completed
class DevLoader extends ex.Loader {
  showPlayButton() {
    return Promise.resolve()
  }
  draw() {}
  dispose() {}
}

export function createLoader(resources: ReturnType<typeof createResources>): ex.Loader {
  const loader = new DevLoader()
  for (const group of Object.values(resources)) {
    for (const resource of Object.values(group)) {
      loader.addResource(resource as ex.Loadable<unknown>)
    }
  }
  return loader
}

// ---------------------------------------------------------------------------
// Module-level singletons — ESM live bindings.
// All scene files import these directly. game.ts calls setResourcesBaseUrl()
// before the engine starts to update both bindings in-place.
// ---------------------------------------------------------------------------

export let Resources = createResources('')
export let loader = createLoader(Resources)

/**
 * Update the module-level Resources and loader to use a new base URL.
 * Must be called before any scene constructor runs (before game.start()).
 * ESM live bindings ensure all importers see the updated values.
 */
export function setResourcesBaseUrl(baseUrl: string): void {
  Resources = createResources(baseUrl)
  loader = createLoader(Resources)
}
