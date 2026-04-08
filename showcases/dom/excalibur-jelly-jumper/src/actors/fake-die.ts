import * as ex from 'excalibur'
import { GRAVITY } from '../physics/gravity'

// temporary until we have a real death system
export class FakeDie extends ex.Actor {
  constructor(args: ex.ActorArgs) {
    super({
      ...args,
      collisionType: ex.CollisionType.Active,
      z: 9999,
    })

    this.body.useGravity = false
    this.acc.y = GRAVITY.y / 2
    this.graphics.use(
      new ex.Text({
        text: '// TODO: die',
        color: ex.Color.White,
        font: new ex.Font({
          size: 10,
          family: 'sans-serif',
        }),
      })
    )

    // random velocity upwards
    this.vel.y = -300
    this.vel.x = ex.randomInRange(-100, 100)
  }

  onPreUpdate(engine: ex.Engine, delta: number): void {
    if (this.isOffScreen) {
      this.kill()
    }
  }
}
