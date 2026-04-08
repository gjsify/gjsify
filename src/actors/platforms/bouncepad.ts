import * as ex from 'excalibur'
import { Resources } from '../../resources'
import { AnimationComponent } from '../../components/graphics/animation'
import { TouchingComponent } from '../../components/physics/touching'
import { AudioManager } from '../../state/audio'
import { OneWayCollisionComponent } from '../../components/physics/one-way-collision'

const grid = {
  rows: 1,
  columns: 3,
  spriteWidth: 48,
  spriteHeight: 48,
}

const variants = {
  green: {
    force: 500,
    spritesheet: ex.SpriteSheet.fromImageSource({
      image: Resources.img.bouncepadGreen,
      grid,
    }),
  },
  red: {
    force: 700,
    spritesheet: ex.SpriteSheet.fromImageSource({
      image: Resources.img.bouncepadRed,
      grid,
    }),
  },
}

export interface BouncepadArgs extends ex.ActorArgs {
  type?: keyof typeof variants
}

export class Bouncepad extends ex.Actor {
  /**
   * The time it takes for the bouncepad to compress and release.
   */
  COMPRESS_TIME = 250
  COMPRESS_DISTANCE = 2

  spritesheet: ex.SpriteSheet
  force: number

  animation: AnimationComponent<'neutral' | 'compressed' | 'released'>

  touching = new TouchingComponent()

  private colliderShape: ex.PolygonCollider

  constructor({ type = 'green', ...args }: BouncepadArgs) {
    super({
      ...args,
      name: 'bouncepad',
      anchor: ex.vec(0.5, 1),
      width: 16,
      height: 16,
      collisionType: ex.CollisionType.Fixed,
    })
    this.graphics.offset = ex.vec(0, 16)

    this.pos.x += this.width * this.anchor.x
    this.pos.y += this.height * this.anchor.y

    this.spritesheet = variants[type].spritesheet
    this.force = variants[type].force

    this.animation = new AnimationComponent({
      neutral: ex.Animation.fromSpriteSheet(this.spritesheet, [2], 0),
      compressed: ex.Animation.fromSpriteSheet(
        this.spritesheet,
        [1],
        this.COMPRESS_TIME
      ),
      released: ex.Animation.fromSpriteSheet(
        this.spritesheet,
        [0, 0, 0, 0, 1],
        150
      ),
    })

    this.colliderShape = ex.Shape.Box(16, 16, this.anchor)
    this.collider.set(this.colliderShape)

    this.addTag('bouncepad')
    this.addComponent(this.animation)
    this.addComponent(this.touching)
    this.addComponent(new OneWayCollisionComponent())
  }

  onInitialize(engine: ex.Engine<any>): void {
    this.graphics.use(this.animation.get('neutral'))

    this.animation.get('compressed').events.on('loop', () => {
      this.release()
    })
    this.animation.get('released').events.on('loop', () => {
      this.animation.set('neutral')
    })
  }

  compress() {
    if (this.animation.current === this.animation.get('compressed')) return
    this.graphics.use(this.animation.get('compressed'))

    // shrink the collider shape
    const topLeftPoint = this.colliderShape.points[0]
    const topRightPoint = this.colliderShape.points[1]

    topLeftPoint.y += this.COMPRESS_DISTANCE
    topRightPoint.y += this.COMPRESS_DISTANCE

    // forces the collider to update
    this.colliderShape.points = this.colliderShape.points

    for (const actor of this.touching.top) {
      if (actor instanceof ex.Actor) {
        actor.pos.y += this.COMPRESS_DISTANCE
      }
    }
  }

  release() {
    if (this.animation.current !== this.animation.get('compressed')) return

    this.graphics.use(this.animation.get('released'))

    // expand the collider shape
    const topLeftPoint = this.colliderShape.points[0]
    const topRightPoint = this.colliderShape.points[1]

    topLeftPoint.y -= this.COMPRESS_DISTANCE
    topRightPoint.y -= this.COMPRESS_DISTANCE

    // forces the collider to update
    this.colliderShape.points = this.colliderShape.points

    for (const actor of this.touching.top) {
      if (actor instanceof ex.Actor) {
        actor.pos.y -= this.COMPRESS_DISTANCE
        actor.vel.y = -this.force
        AudioManager.playSfx(Resources.sfx.jumpSpring)
      }
    }
  }

  onCollisionStart(
    self: ex.Collider,
    other: ex.Collider,
    side: ex.Side,
    contact: ex.CollisionContact
  ): void {
    if (side === ex.Side.Top && other.owner instanceof ex.Actor) {
      this.compress()
    }
  }
}
