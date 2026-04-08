import * as ex from 'excalibur'
import { HealthComponent } from './health'
import { AudioManager } from '../../state/audio'
import { Resources } from '../../resources'

export class DamageableComponent extends ex.Component {
  declare owner: ex.Actor

  events = new ex.EventEmitter<{
    damage: { amount: number; knockback?: 'left' | 'right' }
  }>()

  INVINCIBILITY_DURATION = 2000
  KNOCKBACK_DURATION = 200

  isInvincible: boolean = false
  isBeingKnockedBack: boolean = false

  damage(amount: number, knockback?: 'left' | 'right') {
    if (this.isInvincible) return
    const health = this.owner.get(HealthComponent)

    this.events.emit('damage', { amount, knockback })
    this.isInvincible = true

    AudioManager.playSfx(Resources.sfx.damage)
    if (health) {
      health.amount -= amount
    }

    if (knockback) {
      const yVel = -300
      const xVel = 100 * (knockback === 'left' ? -1 : 1)
      this.owner.vel = ex.vec(xVel, yVel)
      this.owner.acc = ex.vec(0, 0)
      this.isBeingKnockedBack = true
    }

    ex.coroutine(
      this.owner!.scene!.engine,
      function* (this: DamageableComponent): ReturnType<ex.CoroutineGenerator> {
        let elapsed = 0

        let flashRate = 100

        while (
          elapsed <
          Math.max(this.KNOCKBACK_DURATION, this.INVINCIBILITY_DURATION)
        ) {
          elapsed += yield 1

          if (this.isBeingKnockedBack && elapsed >= this.KNOCKBACK_DURATION) {
            this.isBeingKnockedBack = false
            this.owner.vel.x = 0
          }

          if (elapsed >= this.INVINCIBILITY_DURATION) {
            this.isInvincible = false
          }

          if (this.owner.graphics.current) {
            const shouldFlash = Math.floor(elapsed / flashRate) % 2 === 0

            this.owner.graphics.current.opacity = shouldFlash ? 0.35 : 1
          }
        }

        if (this.owner.graphics.current) {
          this.owner.graphics.current.opacity = 1
        }
      }.bind(this)
    )
  }
}
