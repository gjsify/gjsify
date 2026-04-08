import * as ex from 'excalibur'
import { ClimbableComponent } from '../../components/physics/climbable'
import { CollisionGroup } from '../../physics/collision'

export class LadderTile extends ex.Actor {
  constructor(args: ex.ActorArgs) {
    super({
      anchor: ex.vec(0, 0),
      collisionType: ex.CollisionType.Passive,
      collisionGroup: CollisionGroup.Climbable,
      ...args,
    })

    this.addComponent(new ClimbableComponent())
  }
}
