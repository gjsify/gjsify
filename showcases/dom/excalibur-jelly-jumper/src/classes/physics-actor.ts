import * as ex from 'excalibur'
import { TouchingComponent } from '../components/physics/touching'
import { CarriableComponent } from '../components/physics/carrier'

export class PhysicsActor extends ex.Actor {
  touching = new TouchingComponent()

  isOnGround = false

  private _oldPosGlobal = ex.vec(0, 0)

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
      this._oldPosGlobal = this.getGlobalPos().clone()
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
    const bounds = new ex.BoundingBox({
      left: Math.round(this.collider.bounds.left) + 1,
      right: Math.round(this.collider.bounds.right) - 1,
      top: Math.round(this.collider.bounds.top) + 1,
      bottom: Math.round(this.collider.bounds.bottom) - 1,
    })

    let ray1!: ex.Ray
    let ray2!: ex.Ray

    if (side === 'left' || side === 'right') {
      ray1 = new ex.Ray(
        ex.vec(side === 'left' ? bounds.left : bounds.right, bounds.top),
        ex.vec(side === 'left' ? -1 : 1, 0)
      )
      ray2 = new ex.Ray(
        ex.vec(side === 'left' ? bounds.left : bounds.right, bounds.bottom),
        ex.vec(side === 'left' ? -1 : 1, 0)
      )
    } else if (side === 'top' || side === 'bottom') {
      ray1 = new ex.Ray(
        ex.vec(bounds.left, side === 'top' ? bounds.top : bounds.bottom),
        ex.vec(0, side === 'top' ? -1 : 1)
      )
      ray2 = new ex.Ray(
        ex.vec(bounds.right, side === 'top' ? bounds.top : bounds.bottom),
        ex.vec(0, side === 'top' ? -1 : 1)
      )
    }

    return (
      [
        ...this.raycast(ray1, distance, opts),
        ...this.raycast(ray2, distance, opts),
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
