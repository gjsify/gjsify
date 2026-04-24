import * as ex from 'excalibur'
import type { PerformanceMonitor, PerfStats } from './performance-monitor.js'

/**
 * In-game FPS/frame-time overlay rendered in the top-left corner.
 * Toggle visibility with F1. Added to the scene after engine.start().
 */
export class PerformanceHUD extends ex.ScreenElement {
  private readonly _lines: ex.Label[] = []
  private _frameCount = 0
  private readonly _monitor: PerformanceMonitor
  private readonly _platform: string
  private _hudVisible = false

  constructor(monitor: PerformanceMonitor, platform: string) {
    super({
      pos: ex.vec(3, 3),
      anchor: ex.vec(0, 0),
      z: 9999,
      coordPlane: ex.CoordPlane.Screen,
    })
    this._monitor = monitor
    this._platform = platform
  }

  onInitialize(engine: ex.Engine): void {
    const font = new ex.Font({
      family: 'monospace',
      size: 7,
    })

    const initialTexts = [
      `[${this._platform.toUpperCase()}] FPS: --`,
      `Frame: --ms  Dropped: --`,
      `Update: --ms  Draw: --ms`,
      `F1: toggle`,
    ]

    for (let i = 0; i < initialTexts.length; i++) {
      const label = new ex.Label({
        text: initialTexts[i],
        pos: ex.vec(0, i * 9),
        anchor: ex.vec(0, 0),
        font,
        color: ex.Color.fromRGB(0, 255, 80),
        z: this.z,
        coordPlane: ex.CoordPlane.Screen,
      })
      this._lines.push(label)
      this.addChild(label)
    }

    // Start hidden — F1 to reveal
    this._lines.forEach(l => { l.graphics.opacity = 0 })

    engine.input.keyboard.on('press', (evt: ex.KeyEvent) => {
      if (evt.key === ex.Keys.F1) {
        this._hudVisible = !this._hudVisible
        this._lines.forEach(l => {
          l.graphics.opacity = this._hudVisible ? 1 : 0
        })
      }
    })
  }

  onPreUpdate(_engine: ex.Engine, _delta: number): void {
    this._frameCount++
    if (this._frameCount < 30) return
    this._frameCount = 0

    const stats = this._monitor.lastStats
    if (stats) this._renderStats(stats)
  }

  private _renderStats(s: PerfStats): void {
    this._lines[0].text = `[${s.platform.toUpperCase()}] FPS: ${s.fps_avg.toFixed(1)} (min:${s.fps_min.toFixed(1)})`
    this._lines[1].text = `Frame: ${s.frame_avg_ms.toFixed(1)}ms  Dropped: ${s.dropped}/${s.frames}`
    this._lines[2].text = `Update: ${s.update_avg_ms.toFixed(1)}ms  Draw: ${s.draw_avg_ms.toFixed(1)}ms`
    this._lines[3].text = `F1: toggle HUD`
  }
}
