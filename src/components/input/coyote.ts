import * as ex from 'excalibur'

interface CoyoteAction {
  time: number

  /**
   * Called on the owner's preupdate. If it returns true, it will
   * set the action counter to the time. If it returns false, it will
   */
  condition: (dt: number) => boolean
}

/**
 * Tracks a grace period for certain actions. Typically jumping, for example if you
 * want to allow a player to jump for a few frames after they've
 * walked off a ledge. However this component can be used for any
 * action that needs a grace period.
 */
export class CoyoteComponent<
  T extends Record<string, CoyoteAction>
> extends ex.Component {
  actions: T

  counter: Record<keyof T, number> = {} as any

  constructor(actions: T) {
    super()
    this.actions = actions
  }

  onAdd(owner: ex.Entity<any>): void {
    owner.on('preupdate', this.onPreUpdate.bind(this))
  }

  onPreUpdate(ev: ex.PreUpdateEvent) {
    for (const action in this.actions) {
      const coyote = this.actions[action]
      if (coyote.condition(ev.delta)) {
        this.counter[action] = coyote.time
      } else {
        this.counter[action] = Math.max(0, this.counter[action] - ev.delta)
      }
    }
  }

  /**
   * Returns true if the action is allowed
   */
  allow(action: keyof T) {
    return this.counter[action] > 0
  }

  /**
   * Resets the counter for the given action
   */
  reset(action: keyof T) {
    this.counter[action] = 0
  }
}
