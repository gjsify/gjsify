import * as ex from 'excalibur'
import { PhysicsActor } from './physics-actor'
import { StompableComponent } from '../components/behaviours/stompable'
import { KillableComponent } from '../components/behaviours/killable'
import { CollisionGroup } from '../physics/collision'
import { DamageComponent } from '../components/behaviours/damage'

export interface EnemyActorArgs extends ex.ActorArgs {
  stompDuration?: number
}

export class EnemyActor extends PhysicsActor {
  protected killable: KillableComponent
  protected stompable: StompableComponent

  constructor({ stompDuration, ...args }: EnemyActorArgs) {
    super({
      collisionType: ex.CollisionType.Active,
      collisionGroup: CollisionGroup.Enemy,
      ...args,
    })

    this.killable = new KillableComponent({ stompDuration })
    this.stompable = new StompableComponent()

    this.addComponent(new DamageComponent({ amount: 1 }))
    this.addComponent(this.stompable)
    this.addComponent(this.killable)

    this.killable.events.on('kill', this.onKill.bind(this))
  }

  get dead() {
    return this.killable.dead
  }

  set dead(value) {
    this.killable.dead = value
  }

  onPreCollisionResolve(
    self: ex.Collider,
    other: ex.Collider,
    side: ex.Side,
    contact: ex.CollisionContact
  ): void {
    if (other.owner instanceof EnemyActor) {
      contact.cancel()
    }
  }

  onKill() {}
}
