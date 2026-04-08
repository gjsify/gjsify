import * as ex from 'excalibur'

export class ControlsComponent extends ex.Component {
  declare owner: ex.Entity

  type = 'input'

  controls = {
    Left: [ex.Keys.Left, ex.Buttons.DpadLeft],
    Right: [ex.Keys.Right, ex.Buttons.DpadRight],
    Up: [ex.Keys.Up, ex.Buttons.DpadUp],
    Down: [ex.Keys.Down, ex.Buttons.DpadDown],
    Jump: [ex.Keys.A, ex.Buttons.Face1],
    Run: [ex.Keys.S, ex.Buttons.Face3],
  } as const

  isHeld(control: keyof typeof this.controls) {
    const engine = this.owner.scene!.engine
    const [key, button] = this.controls[control]

    return Boolean(
      engine.input.keyboard.isHeld(key) ||
        this.getGamepad()?.isButtonHeld(button)
    )
  }

  wasPressed(control: keyof typeof this.controls) {
    const engine = this.owner.scene!.engine
    const [key, button] = this.controls[control]

    return Boolean(
      engine.input.keyboard.wasPressed(key) ||
        this.getGamepad()?.wasButtonPressed(button)
    )
  }

  wasReleased(control: keyof typeof this.controls) {
    const engine = this.owner.scene!.engine
    const [key, button] = this.controls[control]

    return Boolean(
      engine.input.keyboard.wasReleased(key) ||
        this.getGamepad()?.wasButtonReleased(button)
    )
  }

  getGamepad() {
    const engine = this.owner.scene!.engine
    return [
      engine.input.gamepads.at(0),
      engine.input.gamepads.at(1),
      engine.input.gamepads.at(2),
      engine.input.gamepads.at(3),
    ].find((g) => g.connected)
  }

  /**
   * Returns the latest of the Left or Right keys that was pressed. Helpful for
   * keyboard controls where both keys may be pressed at the same time if you
   * want to prioritize one over the other.
   */
  getHeldXDirection(): 'Left' | 'Right' | undefined {
    const engine = this.owner.scene!.engine

    for (const key of engine.input.keyboard.getKeys().slice().reverse()) {
      if (this.controls.Left.includes(key as any)) return 'Left'
      if (this.controls.Right.includes(key as any)) return 'Right'
    }

    if (this.getGamepad()) {
      if (this.isHeld('Left')) return 'Left'
      if (this.isHeld('Right')) return 'Right'
    }
  }

  getHeldYDirection(): 'Up' | 'Down' | undefined {
    const engine = this.owner.scene!.engine

    for (const key of engine.input.keyboard.getKeys().slice().reverse()) {
      if (this.controls.Up.includes(key as any)) return 'Up'
      if (this.controls.Down.includes(key as any)) return 'Down'
    }

    if (this.getGamepad()) {
      if (this.isHeld('Up')) return 'Up'
      if (this.isHeld('Down')) return 'Down'
    }
  }
}
