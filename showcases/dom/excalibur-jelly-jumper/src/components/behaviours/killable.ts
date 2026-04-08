import * as ex from 'excalibur'
import { StompableComponent } from './stompable'

export type KillMethod = 'instant' | 'stomp'

export interface KillableComponentArgs {
  /**
   * How long the actor should be in the stomp state before being removed.
   *
   * Requires StompableComponent to be present on the actor.
   */
  stompDuration?: number
}

/**
 * Makes an actor damage the player on collision.
 */
export class KillableComponent extends ex.Component {
  declare owner: ex.Actor

  dead = false

  events = new ex.EventEmitter<{ kill: { method: KillMethod } }>()

  private stompDuration = 700

  constructor({ stompDuration }: KillableComponentArgs = {}) {
    super()
    this.stompDuration = stompDuration ?? 700
  }

  kill(method: KillMethod) {
    if (method === 'stomp' && !this.owner.has(StompableComponent)) {
      throw new Error(
        'Cannot kill with stomp method: actor does not have a StompableComponent'
      )
    }

    if (this.dead) return
    this.dead = true

    this.events.emit('kill', { method })

    if (method === 'instant') {
      this.owner.kill()
    } else if (method === 'stomp') {
      const stompable = this.owner.get(StompableComponent)
      this.owner.actions
        .callMethod(() => {
          stompable.stomp()
        })
        .delay(this.stompDuration * 0.8)
        .fade(0, this.stompDuration * 0.2)
        .callMethod(() => {
          this.owner.kill()
        })
    }
  }
}
