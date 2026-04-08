import * as ex from 'excalibur'
import Player from '../actors/player'
import { MovingPlatform } from '../actors/platforms/moving-platform'

export default class Demo extends ex.Scene {
  onInitialize() {
    const player = new Player({ x: 320, y: 32 })
    this.add(player)

    const checkerboardSize = 32
    const checkerboardWidth = 100 * checkerboardSize
    const checkerboardHeight = 8 * checkerboardSize

    // create a 16x16 checkerboard alternating between green and dark green squares
    for (let x = 0; x < checkerboardWidth / checkerboardSize; x++) {
      for (let y = 0; y < checkerboardHeight / checkerboardSize; y++) {
        const isDarkGreen = (x + y) % 2 === 0
        this.add(
          new ex.Actor({
            name: `checkerboard-${x}-${y}`,
            x: -100 + x * checkerboardSize,
            y: 100 + y * checkerboardSize,
            width: checkerboardSize,
            height: checkerboardSize,
            anchor: ex.vec(0.5, 0.5),
            color: isDarkGreen ? ex.Color.fromRGB(0, 100, 0) : ex.Color.Green,
            collisionType: ex.CollisionType.Fixed,
          })
        )
      }
    }

    // const ground = new ex.Actor({
    //   x: -100,
    //   y: 100,
    //   width: 800,
    //   height: 100,
    //   anchor: ex.vec(0.5, 0.5),
    //   color: ex.Color.Green,
    //   collisionType: ex.CollisionType.Fixed,
    // })
    // this.add(ground)

    const trianglePoints = [ex.vec(-128, 16), ex.vec(0, -16), ex.vec(128, 16)]
    const triangle = new ex.Actor({
      name: 'triangle',
      x: 100,
      y: 68,
      collider: new ex.PolygonCollider({ points: trianglePoints }),
      collisionType: ex.CollisionType.Fixed,
    })
    const triangleGraphic = new ex.Polygon({
      points: trianglePoints,
      color: ex.Color.Green,
      filtering: ex.ImageFiltering.Pixel,
      smoothing: false,
      quality: 4,
    })
    triangle.graphics.use(triangleGraphic)
    this.add(triangle)

    const leftwall = new ex.Actor({
      name: 'leftwall',
      x: -100,
      y: 100,
      width: 100,
      height: 800,
      anchor: ex.vec(0.5, 0.5),
      color: ex.Color.Green,
      collisionType: ex.CollisionType.Fixed,
    })
    this.add(leftwall)

    const platform = new MovingPlatform(
      {
        x: 350,
        y: 50,
        width: 100,
        height: 16,
      },
      (actions) =>
        actions.repeatForever(
          (builder) =>
            builder
              .moveBy(50, -50, 100)
              .moveBy(50, 50, 100)
              .moveBy(-50, -50, 500)
              .moveBy(-50, 50, 500)
          // .easeBy(-50, 50, 500, ex.EasingFunctions.EaseOutQuad)
          // .delay(500)
          // .easeBy(50, -50, 500, ex.EasingFunctions.EaseOutQuad)
          // .delay(500)
          // .moveBy(200, -50, 500)
        )
    )
    200
    this.add(platform)

    this.camera.strategy.lockToActor(player as any)
  }
}
