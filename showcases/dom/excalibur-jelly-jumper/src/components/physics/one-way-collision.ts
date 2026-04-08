import * as ex from 'excalibur'

/**
 * A component that makes an actor's collision only work from the top.
 * Used for platforms that the player can jump through from below.
 */
export class OneWayCollisionComponent extends ex.Component {
  type = 'one-way-collision'

  onAdd(owner: ex.Actor): void {
    // extends the onPreCollisionResolve method of the owner actor
    const ogOnPreCollisionResolve = owner.onPreCollisionResolve.bind(owner)
    owner.onPreCollisionResolve = (...args) => {
      this.onPreCollisionResolve(...args)
      ogOnPreCollisionResolve(...args)
    }
  }

  onPreCollisionResolve(
    self: ex.Collider,
    other: ex.Collider,
    side: ex.Side,
    contact: ex.CollisionContact
  ): void {
    if (!(other.owner instanceof ex.Actor)) return

    // the difference between the current and previous position of the other actor
    const otherPosDelta = other.owner.pos.sub(other.owner.oldPos)

    // was the other actor above the platform in the previous frame?
    const otherWasAbovePlatform =
      other.bounds.bottom - otherPosDelta.y < self.bounds.top + 1

    // ignore collision if the collision side is not on the top,
    // or if other was not above the platform in the previous frame
    if (side !== ex.Side.Top || !otherWasAbovePlatform) {
      contact.cancel()
      return
    }
  }
}
