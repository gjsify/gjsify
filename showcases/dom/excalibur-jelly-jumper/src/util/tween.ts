import * as ex from 'excalibur'

/**
 * A tweening class that can be used to animate a value over time.
 */
export class Tween {
  engine: ex.Engine
  value: number

  private _startValue: number = 0
  private _targetValue: number = 0
  private _easing: ex.EasingFunction
  private _duration: number = 0
  private _elapsed: number = 0

  constructor(
    engine: ex.Engine,
    value: number,
    opts: {
      easing?: ex.EasingFunction
      duration?: number
    }
  ) {
    const { easing = ex.EasingFunctions.Linear, duration = 1000 } = opts
    this.engine = engine
    this.value = value
    this._startValue = value
    this._targetValue = value
    this._easing = easing
    this._duration = duration
    engine.on('preupdate', this.onUpdate)
  }

  onUpdate = (ev: ex.PreUpdateEvent<ex.Engine>) => {
    if (this._elapsed < this._duration) {
      this._elapsed = Math.min(this._duration, this._elapsed + ev.delta)

      this.value = this._easing(
        this._elapsed,
        this._startValue,
        this._targetValue,
        this._duration
      )
    }
  }

  set(value: number, immediately = false) {
    this._elapsed = 0

    if (immediately) {
      this.value = value
      this._startValue = value
      this._targetValue = value
    } else {
      this._startValue = this.value
      this._targetValue = value
    }
  }

  destroy() {
    this.engine.off('preupdate', this.onUpdate)
  }
}
