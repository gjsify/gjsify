import * as ex from 'excalibur'
import { Resources } from '../resources';

let currentSong: ex.Sound | null = null

export abstract class AudioManager {
  static levels = new Map<ex.Sound, number>([
    [Resources.music.stage1, .1],
    [Resources.music.stage2, .1],
    [Resources.sfx.jump, .25],
    [Resources.sfx.jumpSpring, .25],
    [Resources.sfx.land, .25],
    [Resources.sfx.turnAround, .25],
    [Resources.sfx.stomp, .25],
    [Resources.sfx.damage, .25],
    [Resources.sfx.collectCoin, .25],
])

  static init() {
      for (let category of Object.values(Resources)){
          for (let resource of Object.values(category)) {
              if (resource instanceof ex.Sound) {
                  resource.volume = AudioManager.levels.get(resource) ?? 1.0;
              }
          }
      }
  }
  static playSong(song: ex.Sound) {
    if (currentSong) {
      currentSong.stop()
    }

    currentSong = song
    currentSong.play()
    currentSong.loop = true
  }

  /**
   * Plays a sound effect if the sound is not already playing
   */
  static playSfx(sfx: ex.Sound, opts: PlaySfxOptions = {}) {
    const { volume = AudioManager.levels.get(sfx), force = false } = opts

    if (force || !sfx.isPlaying()) {
      sfx.play(volume)
    }
  }
}

interface PlaySfxOptions {
  /**
   * The volume to play the sound at (0.0 to 1.0)
   *
   * @default 0.7
   */
  volume?: number

  /**
   * If true, the sound will play even if it is already playing
   *
   * @default false
   */
  force?: boolean
}
