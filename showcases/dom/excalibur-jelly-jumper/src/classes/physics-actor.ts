import * as ex from 'excalibur'
import { TouchingComponent } from '../components/physics/touching.js'
import { CarriableComponent } from '../components/physics/carrier.js'

export class PhysicsActor extends ex.Actor {
  touching = new TouchingComponent()

  isOnGround = false

  private _oldPosGlobal = ex.vec(0, 0)

  // Pre-allocated rays for raycastSide — mutated in-place each call to avoid
  // per-frame Ray + Vector allocations (8 vec() calls per raycastSide invocation).
  private _ray1 = new ex.Ray(ex.vec(0, 0), ex.vec(1, 0))
  private _ray2 = new ex.Ray(ex.vec(0, 0), ex.vec(1, 0))

  constructor(args: ex.ActorArgs) {
    super(args)
    this.addComponent(new CarriableComponent())
  }

  onInitialize(engine: ex.Engine): void {
    this.addComponent(this.touching)

    this.on('preupdate', () => {
      this.isOnGround = this.touching.bottom.size > 0
    })
    this.on('postupdate', () => {
      // setTo() mutates the pre-allocated vector instead of cloning the return value.
      const gp = this.getGlobalPos()
      this._oldPosGlobal.setTo(gp.x, gp.y)
    })
  }

  get canBeCarried() {
    return this.get(CarriableComponent).canBeCarried
  }

  set canBeCarried(value: boolean) {
    this.get(CarriableComponent).canBeCarried = value
  }

  raycast(
    ray: ex.Ray,
    distance: number,
    opts?: Omit<ex.RayCastOptions, 'maxDistance'>
  ) {
    return this.scene!.physics.rayCast(ray, {
      maxDistance: distance,
      searchAllColliders: true, // temporary
      ...opts,
    })
      .filter((hit) => hit.body !== this.body)
      .sort((a, b) => a.distance - b.distance)
  }

  raycastSide(
    side: 'left' | 'right' | 'top' | 'bottom',
    distance: number,
    opts?: Omit<ex.RayCastOptions, 'maxDistance'>
  ) {
    // Compute shrunk collider bounds without allocating a BoundingBox.
    const cb = this.collider.bounds
    const bl = Math.round(cb.left)   + 1
    const br = Math.round(cb.right)  - 1
    const bt = Math.round(cb.top)    + 1
    const bb = Math.round(cb.bottom) - 1

    // Mutate pre-allocated Ray instances instead of creating new ones.
    if (side === 'left' || side === 'right') {
      const x  = side === 'left' ? bl : br
      const dx = side === 'left' ? -1 : 1
      this._ray1.pos.setTo(x, bt); this._ray1.dir.setTo(dx, 0)
      this._ray2.pos.setTo(x, bb); this._ray2.dir.setTo(dx, 0)
    } else {
      const y  = side === 'top' ? bt : bb
      const dy = side === 'top' ? -1 : 1
      this._ray1.pos.setTo(bl, y); this._ray1.dir.setTo(0, dy)
      this._ray2.pos.setTo(br, y); this._ray2.dir.setTo(0, dy)
    }

    return (
      [
        ...this.raycast(this._ray1, distance, opts),
        ...this.raycast(this._ray2, distance, opts),
      ]
        // make unique
        .filter((value, index, self) => {
          return self.indexOf(value) === index
        })
    )
  }

  getGlobalOldPos() {
    return this._oldPosGlobal
  }
}
