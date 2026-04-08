import * as ex from 'excalibur'

/**
 * Attaches actors that land on top as children. They must have a CarriableComponent.
 */
export class CarrierComponent extends ex.Component {
  declare owner: ex.Actor
  type = 'carrier'

  onAdd(owner: ex.Actor): void {
    owner.on('collisionstart', this.onCollisionStart.bind(this))
    owner.on('collisionend', this.onCollisionEnd.bind(this))
    owner.on('initialize', this.onInitialize.bind(this))
  }

  onInitialize(): void {
    const owner = this.owner

    // this is a little trick to force a collision with any actors that
    // are already on top of the platform when it is created
    owner.once('postupdate', () => {
      owner.pos.y -= 1
      owner.once('preupdate', () => {
        owner.pos.y += 1
      })
    })
  }

  /**
   * When an actor lands on top add it as a child so that
   * it moves with the platform.
   */
  onCollisionStart({ other, side }: ex.CollisionStartEvent): void {
    if (other.get(CarriableComponent)?.canBeCarried) {
      if (side === ex.Side.Top && !this.owner.children.includes(other)) {
        this.addChild(other)
      }
    }
  }

  /**
   * When an actor leaves the platform remove it as a child
   */
  onCollisionEnd({ other }: ex.CollisionEndEvent): void {
    if (this.owner.children.includes(other)) {
      this.removeChild(other)
    }
  }

  addChild(actor: ex.Actor) {
    this.owner.addChild(actor)

    // children's position are local to the parent so we need adjust it
    // so that the child stays in the same position on the platform
    actor.pos.x -= this.owner.pos.x
    actor.pos.y -= this.owner.pos.y
  }

  removeChild(actor: ex.Actor) {
    this.owner.removeChild(actor)
    this.owner.scene!.add(actor)

    // now that the child is no longer a child we need to adjust its position
    // back to global coordinates
    actor.pos.x += this.owner.pos.x
    actor.pos.y += this.owner.pos.y
  }
}

/**
 * Enables actors to be carried by other actors with CarrierComponent
 */
export class CarriableComponent extends ex.Component {
  declare owner: ex.Actor

  canBeCarried = true
}
