import * as ex from 'excalibur'
import { Resources } from '../../resources'
import { CollisionGroup } from '../../physics/collision'
import Player from '../player'
import { CarriableComponent } from '../../components/physics/carrier'
import { TouchingComponent } from '../../components/physics/touching'
import { CoinItem } from '../items/coin'

export class LostCoin extends CoinItem {
  touching = new TouchingComponent()

  LIFETIME = 3000
  TIME_UNTIL_COLLECTABLE = 500

  BOUNCE = 1
  FRICTION = 0.1

  constructor(args: ex.ActorArgs) {
    super({
      anchor: ex.vec(0.5, 0.5),
      collisionType: ex.CollisionType.Active,
      collisionGroup: CollisionGroup.PhysicalItem,
      width: 8,
      height: 8,
      z: 500,
      ...args,
    })

    this.pos.x += this.width * this.anchor.x
    this.pos.y -= this.height * this.anchor.y

    this.addComponent(this.touching)
    this.addComponent(new CarriableComponent())
    this.graphics.use(Resources.img.coin.toSprite())
    this.collectable.isCollectable = false
  }

  onInitialize(engine: ex.Engine<any>): void {
    this.actions.runAction(
      new ex.ParallelActions([
        new ex.ActionSequence(this, (ctx) =>
          ctx.delay(this.TIME_UNTIL_COLLECTABLE).callMethod(() => {
            this.collectable.isCollectable = true
          })
        ),
        new ex.ActionSequence(this, (ctx) =>
          ctx.delay(this.LIFETIME).callMethod(() => this.kill())
        ),
      ])
    )
  }

  onPreUpdate(engine: ex.Engine<any>, delta: number): void {
    this.elapsedMs += delta

    const flashRate = 50
    const shouldFlash = Math.floor(this.elapsedMs / flashRate) % 2 === 0

    if (this.graphics.current) {
      this.graphics.current.opacity = shouldFlash ? 0.35 : 0.65
    }
  }

  onPreCollisionResolve(
    self: ex.Collider,
    other: ex.Collider,
    side: ex.Side,
    contact: ex.CollisionContact
  ): void {
    if (other.owner instanceof Player) {
      if (!this.collectable.isCollectable) {
        return contact.cancel()
      }
    }

    super.onPreCollisionResolve(self, other, side, contact)
  }

  onPostCollisionResolve(
    self: ex.Collider,
    other: ex.Collider,
    side: ex.Side,
    contact: ex.CollisionContact
  ): void {
    if (side === ex.Side.Bottom || side === ex.Side.Top) {
      this.vel.x = this.oldVel.x * (1 - this.FRICTION)
    } else if (side == ex.Side.Left || side == ex.Side.Right) {
      this.vel.y = this.oldVel.y * (1 - this.FRICTION)
    }
  }

  onCollisionStart(
    self: ex.Collider,
    other: ex.Collider,
    side: ex.Side,
    contact: ex.CollisionContact
  ): void {
    if (other.owner instanceof Player) {
      super.onCollisionStart(self, other, side, contact)
    } else {
      if (side === ex.Side.Bottom || side === ex.Side.Top) {
        this.vel.y = this.oldVel.y * -this.BOUNCE
      } else if (side == ex.Side.Left || side == ex.Side.Right) {
        this.vel.x = this.oldVel.x * -this.BOUNCE
      }
    }
  }
}
