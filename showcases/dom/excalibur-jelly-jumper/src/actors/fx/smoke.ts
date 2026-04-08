import * as ex from 'excalibur'
import { Resources } from '../../resources'

const variants = {
  puff: {
    spritesheet: ex.SpriteSheet.fromImageSource({
      image: Resources.img.smokePuff,
      grid: {
        rows: 1,
        columns: 8,
        spriteWidth: 32,
        spriteHeight: 32,
      },
    }),
    get animation() {
      return ex.Animation.fromSpriteSheet(
        this.spritesheet,
        [0, 1, 2, 3, 4, 5, 6, 7],
        50,
        ex.AnimationStrategy.End
      )
    },
  },
  land: {
    spritesheet: ex.SpriteSheet.fromImageSource({
      image: Resources.img.smokeLand,
      grid: {
        rows: 1,
        columns: 3,
        spriteWidth: 32,
        spriteHeight: 32,
      },
    }),
    get animation() {
      return ex.Animation.fromSpriteSheet(
        this.spritesheet,
        [0, 0, 0, 1, 1, 2],
        60,
        ex.AnimationStrategy.End
      )
    },
  },
}

export interface SmokeArgs extends ex.ActorArgs {
  type: 'puff' | 'land'
}
export class Smoke extends ex.Actor {
  constructor({ type, ...args }: SmokeArgs) {
    super({ anchor: ex.vec(0.5, 0.5), ...args })

    const animation = variants[type].animation

    animation.events.on('end', () => {
      this.kill()
    })

    this.graphics.use(animation)

    if (type === 'puff') {
      this.vel.y = -20
    }
  }
}
