import * as ex from 'excalibur'
import { loader } from './resources.js'
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

export async function startGame(canvas: HTMLCanvasElement): Promise<GameHandle> {
  AudioManager.init()

  const game = new ex.Engine(buildEngineOptions(canvas))

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
