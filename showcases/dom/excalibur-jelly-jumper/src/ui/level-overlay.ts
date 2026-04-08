import * as ex from 'excalibur'
import Player from '../actors/player'
import { Resources } from '../resources'
import { OutlineMaterial } from '../materials/outline'
import { GameManager } from '../state/game'

/**
 * The UI overlay that displays during the level
 */
export class LevelOverlay extends ex.ScreenElement {
  private playerQuery!: ex.TagQuery<'player'>
  private coinCounter!: CoinCounter

  constructor() {
    super({
      z: 1000,
      anchor: ex.vec(0, 0),
      color: ex.Color.Green,
    })
  }

  get player() {
    return this.playerQuery.entities[0] as Player
  }

  onInitialize(engine: ex.Engine<any>): void {
    this.coinCounter = new CoinCounter({ z: this.z })
    this.playerQuery = engine.currentScene.world.queryTags(['player'])

    this.coinCounter.pos = ex.vec(16, 16)

    this.addChild(this.coinCounter)
    this.pos = ex.vec(this.viewport.left, this.viewport.top)
  }

  get viewport() {
    if (this.scene) {
      const camera = this.scene.camera
      const engine = this.scene.engine

      const cameraLeft = camera.drawPos.x - engine.halfDrawWidth
      const cameraTop = camera.drawPos.y - engine.halfDrawHeight

      return new ex.BoundingBox({
        left: cameraLeft,
        top: cameraTop,
        right: engine.drawWidth,
        bottom: engine.drawHeight,
      })
    }

    return new ex.BoundingBox()
  }
}

class CoinCounter extends ex.ScreenElement {
  private label!: ex.Label

  constructor(args: ex.ActorArgs = {}) {
    super({
      ...args,
      anchor: ex.vec(0, 0.5),
    })
  }

  onInitialize(engine: ex.Engine<any>): void {
    this.label = new ex.Label({
      anchor: ex.vec(0, 0.5),
      text: '0',
      pos: ex.vec(24, -1),
      font: Resources.fonts.round.toFont({
        size: 20,
      }),
      color: ex.Color.White,
      z: this.z,
      coordPlane: ex.CoordPlane.Screen,
    })
    this.label.graphics.material = new OutlineMaterial(
      engine.graphicsContext,
      2
    )
    this.addChild(this.label)
    const icon = new ex.Actor({
      anchor: ex.vec(0, 0.5),
      x: 0,
      y: 8,
      coordPlane: ex.CoordPlane.Screen,
      z: this.z,
    })
    icon.graphics.use(Resources.img.coinsUi.toSprite())
    this.addChild(icon)
  }

  onPreUpdate(engine: ex.Engine<any>, delta: number): void {
    this.label.text = GameManager.coins.toString()
  }
}
