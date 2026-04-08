import * as ex from 'excalibur'
import { Resources } from '../../resources'
import { PhysicsActor } from '../../classes/physics-actor'
import { CollisionGroup } from '../../physics/collision'
import { CarriableComponent } from '../../components/physics/carrier'
import { DamageComponent } from '../../components/behaviours/damage'

export class CircularSawHazard extends PhysicsActor {
  direction = 1
  speed = 25

  bladeSize = {
    width: 24,
    height: 12,
  }

  lastGroundHit: ex.RayCastHit | null = null

  constructor(args: ex.ActorArgs) {
    super({
      ...args,
      name: 'circular-saw',
      anchor: ex.vec(0.5, 0.5),
      width: 4,
      height: 4,
      collisionType: ex.CollisionType.Passive,
      collisionGroup: CollisionGroup.Enemy,
    })

    this.pos.x += this.width * this.anchor.x
    this.pos.y -= this.height * this.anchor.y

    this.body.useGravity = false
    this.graphics.use(Resources.img.circularSaw.toSprite())
    this.graphics.offset = ex.vec(0, 2)

    const blade = new ex.Actor({
      pos: ex.vec(0, 0),
      anchor: ex.vec(0.5, 1),
      width: this.bladeSize.width,
      height: this.bladeSize.height,
      collisionType: ex.CollisionType.Passive,
      collisionGroup: CollisionGroup.Enemy,
    })
    blade.addComponent(new DamageComponent({ amount: 1 }))
    this.addChild(blade)

    this.addComponent(new CarriableComponent())
  }

  onInitialize(engine: ex.Engine<any>): void {
    this.graphics.material = new RenderTopHalfMaterial(
      engine.graphicsContext,
      this
    )
  }

  onPreUpdate(_engine: ex.Engine, delta: number) {
    const edge =
      this.direction === 1
        ? this.collider.bounds.right + this.bladeSize.width / 2
        : this.collider.bounds.left - this.bladeSize.width / 2

    const bottom = this.collider.bounds.bottom - 1

    // check if we are still on the ground
    const [groundHit] = this.raycast(
      new ex.Ray(ex.vec(edge, bottom), ex.Vector.Down),
      1,
      {
        collisionGroup: CollisionGroup.Ground,
      }
    )

    // check if we are hitting a wall
    const [wallHit] = this.raycast(
      new ex.Ray(
        ex.vec(edge, bottom),
        this.direction === 1 ? ex.Vector.Right : ex.Vector.Left
      ),
      1,
      {
        collisionGroup: CollisionGroup.Ground,
      }
    )

    // we've either run out of ground or hit a wall, so reverse direction
    if ((!groundHit && this.lastGroundHit) || wallHit) {
      this.direction *= -1
    }

    // move and rotate the saw
    this.graphics.current!.rotation += ex.toRadians((this.speed * 5) / delta)
    this.vel.x = this.speed * this.direction

    if (groundHit) {
      this.lastGroundHit = groundHit
    }
  }
}

class RenderTopHalfMaterial extends ex.Material {
  constructor(ctx: ex.ExcaliburGraphicsContext, owner: CircularSawHazard) {
    super({
      name: 'render-top-half-material',
      fragmentSource: /*glsl*/ `#version 300 es
        precision mediump float;
  
        uniform sampler2D u_graphic;
        uniform float u_rotation; // rotation in radians

        in vec2 v_uv;
        out vec4 fragColor;

        void main() {
          vec2 center = vec2(0.5, 0.5); // Center of rotation
          vec2 rotatedUV = vec2(
              cos(u_rotation) * (v_uv.x - center.x) - sin(u_rotation) * (v_uv.y - center.y) + center.x,
              sin(u_rotation) * (v_uv.x - center.x) + cos(u_rotation) * (v_uv.y - center.y) + center.y
          );

          // If the y-coordinate of the rotated UV is greater than 0.5, discard the pixel
          if (rotatedUV.y > 0.5) {
              discard;
          }
          
          vec4 color = texture(u_graphic, v_uv);
          fragColor = color;
        }`,
      graphicsContext: ctx,
    })

    owner.on('predraw', () => {
      this.update((shader) => {
        shader.trySetUniformFloat(
          'u_rotation',
          owner.graphics.current!.rotation
        )
      })
    })
  }
}
