import { EventEmitter } from 'excalibur'

let coins = 3

/**
 * A general manager for game state
 */
export abstract class GameManager {
  static events = new EventEmitter<GameManagerEvents>()

  /**
   * The amount of coins collected
   *
   * Coins act as health for the player. When the player is hit
   * they lose coins. If they have 0 coins, they die.
   */
  static get coins() {
    return coins
  }

  static set coins(value: number) {
    if (value < 0) {
      value = 0
    }
    coins = value
    GameManager.events.emit('coinchange', { coins })
  }
}

export interface GameManagerEvents {
  coinchange: { coins: number }
}
