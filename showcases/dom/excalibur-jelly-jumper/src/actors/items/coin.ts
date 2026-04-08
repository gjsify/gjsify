import * as ex from 'excalibur'
import { CollectableComponent } from '../../components/behaviours/collectable'
import { Resources } from '../../resources'
import { AudioManager } from '../../state/audio'
import { CollisionGroup } from '../../physics/collision'
import { GameManager } from '../../state/game'
import Player from '../player'

export class CoinItem extends ex.Actor {
  elapsedMs = 0
  collected = false

  constructor(args: ex.ActorArgs) {
    super({
      anchor: ex.vec(0.5, 0.75),
      collisionType: ex.CollisionType.Passive,
      collisionGroup: CollisionGroup.Item,
      width: 8,
      height: 8,
      ...args,
    })

    this.pos.x += this.width * this.anchor.x
    this.pos.y -= this.height * this.anchor.y

    this.addComponent(new CollectableComponent())
    this.graphics.use(Resources.img.coin.toSprite())
  }

  get collectable() {
    return this.get(CollectableComponent)
  }

  onPreUpdate(engine: ex.Engine<any>, delta: number): void {
    this.elapsedMs += delta

    // bobble up and down
    this.pos.y -= Math.sin(this.elapsedMs / 200) / 10
  }

  collect() {
    if (!this.collectable.isCollectable || this.collectable.isCollected) return

    AudioManager.playSfx(Resources.sfx.collectCoin, { force: true })
    GameManager.coins += 1

    this.collectable.isCollected = true
    this.actions.clearActions()
    this.actions
      .runAction(
        new ex.ParallelActions([
          new ex.ActionSequence(this, (ctx) => ctx.moveBy(ex.vec(0, -16), 150)),
          new ex.ActionSequence(this, (ctx) => ctx.fade(0, 150)),
        ])
      )
      .callMethod(() => {
        this.kill()
      })
  }

  onPreCollisionResolve(
    self: ex.Collider,
    other: ex.Collider,
    side: ex.Side,
    contact: ex.CollisionContact
  ): void {
    if (other.owner instanceof Player) {
      this.collect()
      contact.cancel()
    }
  }
}
