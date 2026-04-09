import * as ex from 'excalibur'
import { ClimbableComponent } from './climbable.js'

type Side = 'left' | 'right' | 'top' | 'bottom'

/**
 * Tracks which entities are touching this entity currently.
 *
 * left, right, top, and bottom will contain active or fixed entities,
 * while passives will contain passive entities.
 */
export class TouchingComponent extends ex.Component {
  type = 'touching'

  private contacts = new Map<
    string,
    {
      contact: ex.CollisionContact
      actor: ex.Actor
      side: Side
    }
  >()

  left = new Set<ex.Actor>()
  right = new Set<ex.Actor>()
  top = new Set<ex.Actor>()
  bottom = new Set<ex.Actor>()

  /**
   * Entities that are touching this entity but are not solid. They are
   * not tracked by side because they can move through the entity.
   */
  passives = new Set<ex.Actor>()

  onAdd(owner: ex.Actor): void {
    // collect up all of the collisionstart/end events for each frame
    //
    // Excalibur 0.32.0: ev.other is a Collider, not an Actor. The owning
    // Actor (and its BodyComponent) is accessed via ev.other.owner.
    //
    // This bug is the root cause of:
    //   - "player can't jump" (isOnGround always false because touching.bottom
    //     is always empty → `if (isOnGround || coyote) jump()` never fires)
    //   - "player keeps running after key release" (applyDeceleration only
    //     decelerates when isOnGround=true; in air there's only turn-
    //     deceleration and max-velocity clamp)
    owner.on('collisionstart', (ev) => {
      const otherActor = ev.other.owner as ex.Actor
      if (otherActor) {
        const body = otherActor.get(ex.BodyComponent)
        if (body?.collisionType === ex.CollisionType.Passive) {
          this.passives.add(otherActor)
        } else {
          const side = ev.side.toLowerCase() as
            | 'left'
            | 'right'
            | 'top'
            | 'bottom'

          this.contacts.set(ev.contact.id, {
            contact: ev.contact,
            actor: otherActor,
            side,
          })
          this.updateSides()
        }
      }
    })

    owner.on('collisionend', (ev) => {
      const otherActor = ev.other.owner as ex.Actor
      const body = otherActor?.get(ex.BodyComponent)
      if (body?.collisionType === ex.CollisionType.Passive) {
        this.passives.delete(otherActor)
      } else {
        this.contacts.delete(ev.lastContact.id)
        this.updateSides()
      }
    })
  }

  private updateSides() {
    this.left.clear()
    this.right.clear()
    this.top.clear()
    this.bottom.clear()

    for (const { side, actor } of this.contacts.values()) {
      this[side].add(actor)
    }
  }

  get ladders() {
    return new Set(
      Array.from(this.passives).filter((e) => e.has(ClimbableComponent))
    )
  }
}
