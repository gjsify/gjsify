import * as ex from 'excalibur'
import { ClimbableComponent } from './climbable'

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
    owner.on('collisionstart', (ev) => {
      if (ev.other.collider) {
        if (ev.other.body?.collisionType === ex.CollisionType.Passive) {
          this.passives.add(ev.other)
        } else {
          const side = ev.side.toLowerCase() as
            | 'left'
            | 'right'
            | 'top'
            | 'bottom'

          this.contacts.set(ev.contact.id, {
            contact: ev.contact,
            actor: ev.other,
            side,
          })
          this.updateSides()
        }
      }
    })

    owner.on('collisionend', (ev) => {
      if (ev.other.body?.collisionType === ex.CollisionType.Passive) {
        this.passives.delete(ev.other)
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
