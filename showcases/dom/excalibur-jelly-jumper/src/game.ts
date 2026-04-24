import * as ex from 'excalibur'
import { loader, Resources } from './resources.js'
import Level1 from './scenes/level1.js'
import Demo from './scenes/demo.js'
import { GRAVITY } from './physics/gravity.js'
import { AudioManager } from './state/audio.js'
import { PerformanceMonitor } from './perf/performance-monitor.js'
import { PerformanceHUD } from './perf/performance-hud.js'

export interface GameHandle {
  engine: ex.Engine
  pause(): void
  resume(): void
  readonly isPaused: boolean
  mute(): void
  unmute(): void
  readonly isMuted: boolean
}

export interface StartGameOptions {
  startMuted?: boolean
  /** Base URL for game assets. When set, all `/res/...` paths are rewritten. */
  assetBase?: string
  /** Platform tag shown in the perf HUD and [PERF] console lines. */
  platform?: 'gjs' | 'browser'
  /**
   * Override pixel ratio (device pixel ratio multiplier).
   * Default: 4. Reduce to 2 on GJS to halve framebuffer work per frame.
   */
  pixelRatio?: number
  /**
   * Fixed physics update rate in fps. Default: 60.
   * Reduce to 30 on GJS if the accumulator causes jitter (>16ms frames).
   */
  fixedUpdateFps?: number
  /** Enable in-game FPS overlay (F1 to toggle) + [PERF] console logging. */
  enablePerf?: boolean
}

function buildEngineOptions(canvas: HTMLCanvasElement, options?: StartGameOptions): ex.EngineOptions {
  return {
    canvasElement: canvas,
    suppressMinimumBrowserFeatureDetection: true,
    suppressConsoleBootMessage: true,
    resolution: {
      height: ex.Resolution.SNES.height,
      width: (ex.Resolution.SNES.height / 9) * 16,
    },
    displayMode: ex.DisplayMode.FitContainerAndFill,
    fixedUpdateFps: options?.fixedUpdateFps ?? 60,
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
    pixelRatio: options?.pixelRatio ?? 4,
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

/** Rewrite all resource paths from `/res/...` to `${base}res/...` */
function rebaseResources(base: string): void {
  for (const category of Object.values(Resources)) {
    for (const resource of Object.values(category)) {
      if (!resource || typeof resource !== 'object') continue
      const r = resource as any
      const rebase = (p: string) => p.startsWith('/res/') ? base + p.slice(1) : p

      // ImageSource: readonly `path` + internal `_resource.path`
      if (typeof r.path === 'string') {
        r.path = rebase(r.path)
      }
      if (r._resource && typeof r._resource.path === 'string') {
        r._resource.path = rebase(r._resource.path)
      }
      // Sound: path getter/setter delegates to _resource.path — handled above
      // TiledResource: has `path` property
    }
  }
}

export async function startGame(canvas: HTMLCanvasElement, options?: StartGameOptions): Promise<GameHandle> {
  if (options?.assetBase) rebaseResources(options.assetBase)
  AudioManager.init(options?.startMuted)

  const pixelRatio = options?.pixelRatio ?? 4
  const platform = options?.platform ?? 'browser'

  const game = new ex.Engine(buildEngineOptions(canvas, options))

  await game.start(loader)
  game.screen.pixelRatioOverride = pixelRatio
  game.screen.applyResolutionAndViewport()

  if (options?.enablePerf) {
    const monitor = new PerformanceMonitor(platform)
    monitor.attach(game)
    const hud = new PerformanceHUD(monitor, platform)
    game.currentScene.add(hud)
  }

  let paused = false
  return {
    engine: game,
    get isPaused() { return paused },
    pause()  { if (!paused) { paused = true;  game.stop();  } },
    resume() { if (paused)  { paused = false; game.start(); } },
    get isMuted() { return AudioManager.isMuted },
    mute()   { AudioManager.muteAll() },
    unmute() { AudioManager.unmuteAll() },
  }
}
