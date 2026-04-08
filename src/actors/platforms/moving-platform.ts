import * as ex from 'excalibur'
import { OneWayCollisionComponent } from '../../components/physics/one-way-collision'
import { CarrierComponent } from '../../components/physics/carrier'
import { Resources } from '../../resources'
import { CollisionGroup } from '../../physics/collision'

const sprite = Resources.img.platform.toSprite()

// our platform sprite is only 48x16, so we'll chpp it up into 3 piece - left, middle, right -
// so that we can extend the platform to be as wide as we need
const leftEnd = new ex.Sprite({
  image: sprite.image,
  destSize: {
    height: 16,
    width: 16,
  },
  sourceView: {
    x: 0,
    y: 0,
    width: 16,
    height: 16,
  },
})
const rightEnd = new ex.Sprite({
  image: sprite.image,
  destSize: {
    height: 16,
    width: 16,
  },
  sourceView: {
    x: 32,
    y: 0,
    width: 16,
    height: 16,
  },
})

const middle = new ex.Sprite({
  image: sprite.image,
  destSize: {
    height: 16,
    width: 16,
  },
  sourceView: {
    x: 16,
    y: 0,
    width: 16,
    height: 16,
  },
})

export interface MovingPlatformArgs extends ex.ActorArgs {
  oneWay?: boolean
}

export class MovingPlatform extends ex.Actor {
  constructor(
    { oneWay = true, ...args }: MovingPlatformArgs,
    cb: (actions: ex.ActionsComponent) => any
  ) {
    super({
      color: ex.Color.Green,
      anchor: ex.vec(0, 0),
      collisionType: ex.CollisionType.Fixed,
      collisionGroup: CollisionGroup.Ground,
      ...args,
    })

    const middleWidth = this.width - 32

    // compose the platform graphic from the 3 pieces
    this.graphics.use(
      new ex.GraphicsGroup({
        members: [
          {
            graphic: leftEnd,
            offset: ex.vec(0, 0),
          },
          ...Array.from({ length: middleWidth / 16 }, (_, i) => ({
            graphic: middle,
            offset: ex.vec(16 + i * 16, 0),
          })),
          {
            graphic: rightEnd,
            offset: ex.vec(this.width - 16, 0),
          },
        ],
      })
    )
    cb(this.actions)

    this.addComponent(new CarrierComponent())

    if (oneWay) {
      this.addComponent(new OneWayCollisionComponent())
    }
  }
}
