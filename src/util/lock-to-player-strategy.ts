import * as ex from 'excalibur'
import Player from '../actors/player'
import { Tween } from './tween'

/**
 * A camera strategy that locks the camera to the player, but keeps
 * the camera ahead smothly so that the player can see what's coming.
 */
export class LockToPlayerStrategy implements ex.CameraStrategy<Player> {
  /**
   * The damping factor for the camera when following target position.
   *
   * Between 0 and 1, where 0 is no damping and 1 is no movement.
   */
  FOLLOW_DAMPING = 0.5

  /**
   * How long it takes for the camera to turn around when the player
   * is at the X_EDGE_BUFFER or Y_EDGE_BUFFER.
   */
  TURN_TWEEN_DURATION = 400

  /**
   * The number of pixels from the center of the screen that the player
   * can move before the camera starts to follow.
   */
  X_EDGE_BUFFER = 20
  Y_EDGE_BUFFER = 40

  target: Player
  xOffset: Tween

  facing: 'left' | 'right' = 'right'

  private isFirstUpdate = true

  constructor(target: Player) {
    this.target = target
    this.xOffset = new Tween(this.target.scene!.engine, 0, {
      easing: ex.EasingFunctions.Linear,
      duration: this.TURN_TWEEN_DURATION,
    })
    this.turn('right', true)
  }

  action(target: Player, camera: ex.Camera, engine: ex.Engine, delta: number) {
    // get global position of target as target.pos is relative to its parent
    const targetPos = target.getGlobalPos()

    const relativeX = targetPos.x - camera.pos.x + this.xOffset.value
    const relativeY = targetPos.y - camera.pos.y

    const isAtLeftEdge = relativeX < -this.X_EDGE_BUFFER
    const isAtRightEdge = relativeX > this.X_EDGE_BUFFER

    const isAtTopEdge = relativeY < -this.Y_EDGE_BUFFER
    const isAtBottomEdge = relativeY > this.Y_EDGE_BUFFER

    let nextX = camera.pos.x
    let nextY = camera.pos.y

    if (
      (isAtLeftEdge && this.facing !== 'left') ||
      (isAtRightEdge && this.facing !== 'right')
    ) {
      this.turn(isAtLeftEdge ? 'left' : 'right')
    }

    if (isAtLeftEdge) {
      nextX = targetPos.x + this.X_EDGE_BUFFER + this.xOffset.value
    } else if (isAtRightEdge) {
      nextX = targetPos.x - this.X_EDGE_BUFFER + this.xOffset.value
    }

    if (isAtTopEdge || isAtBottomEdge) {
      nextY = isAtTopEdge
        ? targetPos.y + this.Y_EDGE_BUFFER
        : targetPos.y - this.Y_EDGE_BUFFER
    }

    // set position on first update immediately
    if (this.isFirstUpdate) {
      this.isFirstUpdate = false
      return ex.vec(nextX, nextY)
    }
    // apply damping when following the player
    else {
      if (isAtLeftEdge || isAtRightEdge) {
        const diffX = nextX - camera.pos.x
        const diffY = nextY - camera.pos.y

        if (Math.abs(diffX) > 0.1) {
          nextX -= diffX * this.FOLLOW_DAMPING
        }

        if (Math.abs(diffY) > 0.1) {
          nextY -= diffY * this.FOLLOW_DAMPING
        }
      }
    }

    return ex.vec(nextX, nextY)
  }

  turn(direction: 'left' | 'right', immediately = false) {
    this.facing = direction
    if (direction === 'left') {
      this.xOffset.set(-this.X_EDGE_BUFFER * 4, immediately)
    } else {
      this.xOffset.set(this.X_EDGE_BUFFER * 4, immediately)
    }
  }
}
