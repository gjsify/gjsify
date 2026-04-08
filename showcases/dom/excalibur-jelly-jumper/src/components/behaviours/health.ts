import * as ex from 'excalibur'
import { EventEmitter } from 'excalibur'

export class HealthComponent extends ex.Component {
  private _amount: number
  private _max: number

  events = new EventEmitter<{ die: void; change: { amount: number } }>()

  constructor({ amount }: { amount: number }) {
    super()

    this._max = amount
    this._amount = amount
  }

  get max() {
    return this._max
  }

  get amount() {
    return this._amount
  }

  set amount(value: number) {
    this._amount = value
    this.events.emit('change', { amount: value })
    if (this._amount <= 0) {
      this.events.emit('die')
    }
  }
}
