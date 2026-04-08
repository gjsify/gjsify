import * as ex from 'excalibur'
import { setResourcesBaseUrl, loader } from './resources.js'
import Level1 from './scenes/level1.js'
import Demo from './scenes/demo.js'
import { GRAVITY } from './physics/gravity.js'
import { AudioManager } from './state/audio.js'

export interface GameHandle {
  engine: ex.Engine
  pause(): void
  resume(): void
  readonly isPaused: boolean
}

function buildEngineOptions(canvas: HTMLCanvasElement): ex.EngineOptions {
  return {
    canvasElement: canvas,
    suppressMinimumBrowserFeatureDetection: true,
    suppressPlayButton: true,
    suppressConsoleBootMessage: true,
    resolution: {
      height: ex.Resolution.SNES.height,
      width: (ex.Resolution.SNES.height / 9) * 16,
    },
    displayMode: ex.DisplayMode.FitContainerAndFill,
    fixedUpdateFps: 60,
    physics: {
      gravity: GRAVITY,
      solver: ex.SolverStrategy.Arcade,
      arcade: {
        contactSolveBias: ex.ContactSolveBias.VerticalFirst,
      },
      colliders: {
        compositeStrategy: 'separate',
      },
    },
    pixelRatio: 4,
    pixelArt: true,
    scenes: {
      root: {
        scene: Level1,
        transitions: {
          out: new ex.FadeInOut({ duration: 300, direction: 'out' }),
          in: new ex.FadeInOut({ duration: 300, direction: 'in' }),
        },
      },
      demo: Demo,
    },
  }
}

export async function startGame(canvas: HTMLCanvasElement, baseUrl: string): Promise<GameHandle> {
  // Update module-level Resources and loader to use the correct base URL.
  // Scene constructors run lazily (on first scene start), so they will see
  // the updated Resources binding via ESM live bindings.
  setResourcesBaseUrl(baseUrl)
  AudioManager.init()

  const game = new ex.Engine(buildEngineOptions(canvas))

  // loader is a live binding — reads the updated value after setResourcesBaseUrl
  await game.start(loader)
  game.screen.pixelRatioOverride = 4
  game.screen.applyResolutionAndViewport()

  let paused = false
  return {
    engine: game,
    get isPaused() { return paused },
    pause()  { if (!paused) { paused = true;  game.stop();  } },
    resume() { if (paused)  { paused = false; game.start(); } },
  }
}
