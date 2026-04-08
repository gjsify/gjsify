import * as ex from 'excalibur'
import { EnemyActor } from '../../classes/enemy-actor'
import { Resources } from '../../resources'
import Player from '../player'

const grid = {
  rows: 1,
  columns: 3,
  spriteWidth: 64,
  spriteHeight: 48,
}

const variants = {
  green: {
    speed: 20,
    spritesheet: ex.SpriteSheet.fromImageSource({
      image: Resources.img.spiderGreen,
      grid,
    }),
  },
  gray: {
    speed: 30,
    spritesheet: ex.SpriteSheet.fromImageSource({
      image: Resources.img.spiderGray,
      grid,
    }),
  },
}

export interface SpiderEnemyArgs extends ex.ActorArgs {
  type: keyof typeof variants
}

export class SpiderEnemy extends EnemyActor {
  spritesheet: ex.SpriteSheet

  speed: number
  direction: 'left' | 'right' = 'left'

  constructor(args: SpiderEnemyArgs) {
    super({
      ...args,
      anchor: ex.vec(0.5, 32 / 48),
      collider: ex.Shape.Box(24, 4, ex.vec(0.5, 1)),
    })

    this.spritesheet = variants[args.type].spritesheet
    this.speed = variants[args.type].speed

    this.graphics.use(
      ex.Animation.fromSpriteSheet(
        this.spritesheet,
        [0, 1, 2],
        2500 / this.speed
      )
    )
  }

  onPreUpdate(engine: ex.Engine, delta: number): void {
    if (this.dead) return

    const bottomLeft = this.raycast(
      new ex.Ray(
        ex.vec(
          this.collider.bounds.left + 1,
          Math.round(this.collider.bounds.bottom) - 1
        ),
        ex.Vector.Down
      ),
      1
    )

    const bottomRight = this.raycast(
      new ex.Ray(
        ex.vec(
          this.collider.bounds.right - 1,
          Math.round(this.collider.bounds.bottom) - 1
        ),
        ex.Vector.Down
      ),
      1
    )

    const isAtLeftEdge = this.direction === 'left' && bottomLeft.length === 0
    const isAtRightEdge = this.direction === 'right' && bottomRight.length === 0

    if (isAtLeftEdge || isAtRightEdge) {
      this.direction = this.direction === 'left' ? 'right' : 'left'
    }

    this.graphics.flipHorizontal = this.direction === 'right'

    if (this.direction === 'left') {
      this.vel.x = -this.speed
    } else {
      this.vel.x = this.speed
    }
  }

  onCollisionStart(
    self: ex.Collider,
    other: ex.Collider,
    side: ex.Side,
    contact: ex.CollisionContact
  ): void {
    if (other instanceof Player) {
      return
    }

    if (other.owner instanceof ex.Actor) {
      if (other.owner.body.collisionType === ex.CollisionType.Passive) {
        return
      }
    }

    if (side === ex.Side.Left || side === ex.Side.Right) {
      this.direction = this.direction === 'left' ? 'right' : 'left'
    }
  }

  onKill() {
    const anim = this.graphics.current as ex.Animation

    anim.pause()
    this.vel.x = 0
    this.vel.y = 0
    this.body.useGravity = false
  }
}
