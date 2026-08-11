import { EventEmitter } from 'excalibur';

let coins = 3;

export abstract class GameManager {
    static events = new EventEmitter<GameManagerEvents>();

    /** Coins ARE health: a hit costs coins, and reaching 0 kills the player. */
    static get coins() {
        return coins;
    }

    static set coins(value: number) {
        if (value < 0) {
            value = 0;
        }
        coins = value;
        GameManager.events.emit('coinchange', { coins });
    }
}

export interface GameManagerEvents {
    coinchange: { coins: number };
}
