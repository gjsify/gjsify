import * as ex from 'excalibur'
import { EnemyActor } from '../classes/enemy-actor'

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

  onPreUpdate(engine: ex.Engine, delta: number): void {
    const camera = engine.currentScene.camera
    const boundsWithBuffer = new ex.BoundingBox(
      camera.viewport.left - this.OFFSCREEN_BUFFER,
      camera.viewport.top - this.OFFSCREEN_BUFFER,
      camera.viewport.right + this.OFFSCREEN_BUFFER,
      camera.viewport.bottom + this.OFFSCREEN_BUFFER
    )

    const isOffScreen = !boundsWithBuffer.contains(this.pos)

    if (!isOffScreen) {
      this.spawnInstance()
    } else if (isOffScreen && !this.spawnedInstance) {
      this.canSpawn = true
    }

    if (
      this.spawnedInstance &&
      !boundsWithBuffer.contains(this.spawnedInstance.getGlobalPos())
    ) {
      this.spawnedInstance.kill()
      this.spawnedInstance = null
    }
  }
}
