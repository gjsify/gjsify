import * as ex from 'excalibur'
import { OneWayCollisionComponent } from '../../components/physics/one-way-collision.js'
import { CollisionGroup } from '../../physics/collision.js'

export class OneWayPlatform extends ex.Actor {
  constructor(args: ex.ActorArgs) {
    super({
      ...args,
      collisionType: ex.CollisionType.Fixed,
      collisionGroup: CollisionGroup.Ground,
      anchor: ex.vec(0, 0),
      height: 16,
    } as ex.ActorArgs)

    this.addComponent(new OneWayCollisionComponent())
  }
}
