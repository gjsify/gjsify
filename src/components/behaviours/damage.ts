import * as ex from 'excalibur'
import { DamageableComponent } from './damageable'
import { KillableComponent } from './killable'
import { StompableComponent } from './stompable'
import { PhysicsActor } from '../../classes/physics-actor'

/**
 * Hurts the other actor on collision if it has a Damageable component
 */
export class DamageComponent extends ex.Component {
  declare owner: ex.Actor

  amount: number

  cancelContactOnDamage: boolean

  constructor({
    amount,
    cancelContactOnDamage,
  }: {
    amount: number
    cancelContactOnDamage?: boolean
  }) {
    super()

    this.amount = amount
    this.cancelContactOnDamage = cancelContactOnDamage ?? true
  }

  onAdd(owner: ex.Actor): void {
    owner.on('precollision', this.onPreCollisionResolve.bind(this))
  }

  onPreCollisionResolve(event: ex.PreCollisionEvent) {
    const killable = this.owner.get(KillableComponent)
    const stompable = this.owner.get(StompableComponent)

    const dead = killable?.dead ?? false

    const other = event.other
    const damageable = other.get(DamageableComponent)

    // prevent race condition with player's onPreCollisionResolve where it determines if it's stomping the enemy
    // (otherwise player could get hurt and stomp at the same time)
    const isBeingStomped =
      other instanceof PhysicsActor && stompable?.isBeingStomped(other)

    if (damageable) {
      if (this.cancelContactOnDamage) {
        event.contact.cancel()
      }

      if (!dead && !isBeingStomped) {
        damageable.damage(
          this.amount,
          other.center.x < this.owner.center.x ? 'left' : 'right'
        )
      }
    }
  }
}
