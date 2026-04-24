import * as ex from 'excalibur'

export interface PerfStats {
  platform: string
  frames: number
  fps_avg: number
  fps_min: number
  fps_max: number
  update_avg_ms: number
  draw_avg_ms: number
  frame_avg_ms: number
  dropped: number
}

/**
 * Hooks into Excalibur engine events to collect frame/update/draw timing.
 * Logs a [PERF] JSON line to console every 60 frames for both GJS and browser.
 *
 * GJS usage:  gjsify run dist/gjs.js 2>&1 | grep '\[PERF\]' > gjs.log
 * Browser:    open http://localhost:8080?perf=1 → copy [PERF] lines from DevTools
 */
export class PerformanceMonitor {
  private readonly _platform: string
  private _updateStart = 0
  private _drawStart = 0
  private _frameStart = 0
  private _firstFrame = true
  private _frameTimes: number[] = []
  private _updateTimes: number[] = []
  private _drawTimes: number[] = []
  private _droppedFrames = 0
  private _sampleCount = 0
  private readonly _logInterval = 60
  private _logToConsole = false
  private _updateCallback?: (stats: PerfStats) => void
  private _lastStats: PerfStats | null = null

  constructor(platform: 'gjs' | 'browser') {
    this._platform = platform
  }

  get lastStats(): PerfStats | null {
    return this._lastStats
  }

  onUpdate(cb: (stats: PerfStats) => void): void {
    this._updateCallback = cb
  }

  attach(engine: ex.Engine, logToConsole = false): void {
    this._logToConsole = logToConsole
    engine.on('preupdate', () => {
      this._updateStart = performance.now()
    })

    engine.on('postupdate', () => {
      this._updateTimes.push(performance.now() - this._updateStart)
    })

    engine.on('predraw', () => {
      this._drawStart = performance.now()
    })

    engine.on('postdraw', () => {
      this._drawTimes.push(performance.now() - this._drawStart)

      const now = performance.now()
      if (!this._firstFrame) {
        const ft = now - this._frameStart
        this._frameTimes.push(ft)
        if (ft > 20) this._droppedFrames++
      }
      this._frameStart = now
      this._firstFrame = false
      this._sampleCount++

      if (this._sampleCount >= this._logInterval) {
        this._report()
        this._frameTimes = []
        this._updateTimes = []
        this._drawTimes = []
        this._droppedFrames = 0
        this._sampleCount = 0
      }
    })
  }

  private _avg(arr: number[]): number {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  }

  private _report(): void {
    const frameAvg = this._avg(this._frameTimes)
    const frameMax = this._frameTimes.length ? Math.max(...this._frameTimes) : 0
    const frameMin = this._frameTimes.length ? Math.min(...this._frameTimes) : 0

    const stats: PerfStats = {
      platform: this._platform,
      frames: this._frameTimes.length,
      fps_avg: +(frameAvg > 0 ? 1000 / frameAvg : 0).toFixed(1),
      fps_min: +(frameMax > 0 ? 1000 / frameMax : 0).toFixed(1),
      fps_max: +(frameMin > 0 ? 1000 / frameMin : 0).toFixed(1),
      update_avg_ms: +this._avg(this._updateTimes).toFixed(2),
      draw_avg_ms: +this._avg(this._drawTimes).toFixed(2),
      frame_avg_ms: +frameAvg.toFixed(2),
      dropped: this._droppedFrames,
    }
    this._lastStats = stats
    if (this._logToConsole) console.log('[PERF]', JSON.stringify(stats))
    this._updateCallback?.(stats)
  }
}
