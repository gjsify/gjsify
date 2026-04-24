import * as ex from 'excalibur'
import { EnemyActor } from '../classes/enemy-actor.js'

export interface EnemySpawnerArgs {
  x: number
  y: number
  spawn: (pos: ex.Vector) => EnemyActor
}

/**
 * Spawns an enemy at the given position and respawns
 * when the enemy is killed or leaves the viewport
 */
export class EnemySpawner extends ex.Actor {
  OFFSCREEN_BUFFER = 100

  private spawnedInstance: EnemyActor | null = null
  private canSpawn = true

  spawn: (pos: ex.Vector) => EnemyActor

  constructor({ x, y, spawn }: EnemySpawnerArgs) {
    super({
      x,
      y,
    })

    this.spawn = spawn

    this.on('enterviewport', () => {
      this.spawnInstance()
    })
  }

  spawnInstance() {
    if (this.spawnedInstance || !this.canSpawn) return

    this.canSpawn = false
    this.spawnedInstance = this.spawn(this.pos)

    this.spawnedInstance.on('kill', () => {
      this.spawnedInstance = null
    })

    this.scene!.engine.add(this.spawnedInstance)
  }

  onPreUpdate(engine: ex.Engine, _elapsed: number): void {
    const vp = engine.currentScene.camera.viewport
    const buf = this.OFFSCREEN_BUFFER
    const left   = vp.left   - buf
    const top    = vp.top    - buf
    const right  = vp.right  + buf
    const bottom = vp.bottom + buf

    const { x, y } = this.pos
    const isOffScreen = x < left || x > right || y < top || y > bottom

    if (!isOffScreen) {
      this.spawnInstance()
    } else if (!this.spawnedInstance) {
      this.canSpawn = true
    }

    if (this.spawnedInstance) {
      const ip = this.spawnedInstance.getGlobalPos()
      if (ip.x < left || ip.x > right || ip.y < top || ip.y > bottom) {
        this.spawnedInstance.kill()
        this.spawnedInstance = null
      }
    }
  }
}
