import * as ex from 'excalibur'
import { PhysicsActor } from '../../classes/physics-actor'

/**
 * Makes an actor damage the player on collision.
 */
export class StompableComponent extends ex.Component {
  declare owner: ex.Actor

  stomped = false

  stomp() {
    if (this.stomped) return
    this.stomped = true
    this.owner.graphics.current!.scale = ex.vec(1, 0.25)
  }

  isBeingStomped(other: PhysicsActor) {
    // a lenient check to see if we stomped on the enemy by using the previous position.y
    // (we could check for side === ex.Side.Bottom, but depending on the angle you stomp an enemy, it might not be the case)
    const otherPosDelta = other.getGlobalPos().sub(other.getGlobalOldPos())

    return (
      other.collider.bounds.bottom - otherPosDelta.y <
      this.owner.collider.bounds.top + 1
    )
  }
}
