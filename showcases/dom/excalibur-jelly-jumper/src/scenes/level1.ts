import { Resources } from '../resources.js'
import LevelScene from '../classes/level-scene.js'

export default class Level1 extends LevelScene {
  constructor() {
    super({
      tilemap: Resources.tiled.level1,
      background: Resources.img.level1Background,
      song: Resources.music.stage1,
    })
  }
}
