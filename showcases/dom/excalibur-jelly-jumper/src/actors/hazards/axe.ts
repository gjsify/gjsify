import * as ex from 'excalibur'
import { Resources } from '../../resources'
import { GRAVITY } from '../../physics/gravity'
import { DamageComponent } from '../../components/behaviours/damage'
import { CollisionGroup } from '../../physics/collision'

export class AxeHazard extends ex.Actor {
  private elapsedMs = 0

  constructor(args: ex.ActorArgs) {
    super({
      ...args,
      anchor: ex.vec(0.5, 0),
      width: 12,
      height: 48,
      rotation: 0,
      collisionType: ex.CollisionType.Passive,
      collisionGroup: CollisionGroup.Enemy,
      // just the axe blade is the collider
      collider: ex.Shape.Box(28, 12, ex.vec(0.5, 0.5), ex.vec(0, 42)),
    })

    this.body.useGravity = false
    this.graphics.offset = ex.vec(0, -8)
    this.graphics.use(Resources.img.axe.toSprite())
    this.addComponent(new DamageComponent({ amount: 1 }))
  }

  onPreUpdate(_engine: ex.Engine, delta: number) {
    this.elapsedMs += delta

    const initialAngle = Math.PI / 2
    const time = this.elapsedMs / 1000

    // the larger the slower
    const length = 600

    // pendulum motion
    this.rotation =
      initialAngle * Math.cos(Math.sqrt(GRAVITY.y / length) * time)
  }
}
