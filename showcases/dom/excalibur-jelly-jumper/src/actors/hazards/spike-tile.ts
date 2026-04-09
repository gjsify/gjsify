import * as ex from 'excalibur'
import { DamageComponent } from '../../components/behaviours/damage.js'
import { CollisionGroup } from '../../physics/collision.js'

export class SpikeTile extends ex.Actor {
  constructor(args: ex.ActorArgs) {
    super({
      ...args,
      name: 'spike',
      anchor: ex.vec(0, 0),
      width: 16,
      height: 16,
      collisionType: ex.CollisionType.Fixed,
      collisionGroup: CollisionGroup.Ground,
    } as ex.ActorArgs)

    this.addComponent(
      new DamageComponent({ amount: 1, cancelContactOnDamage: false })
    )
  }
}
