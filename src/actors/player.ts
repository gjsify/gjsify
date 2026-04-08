import * as ex from 'excalibur'
import { Resources } from '../resources'
import { AnimationComponent } from '../components/graphics/animation'
import { ControlsComponent } from '../components/input/controls'
import { PhysicsActor } from '../classes/physics-actor'
import { AudioManager } from '../state/audio'
import { GRAVITY } from '../physics/gravity'
import { Bouncepad } from './platforms/bouncepad'
import { StompableComponent } from '../components/behaviours/stompable'
import { KillableComponent } from '../components/behaviours/killable'
import { CollisionGroup } from '../physics/collision'
import { Smoke } from './fx/smoke'
import { HealthComponent } from '../components/behaviours/health'
import { DamageableComponent } from '../components/behaviours/damageable'
import { ClimbableComponent } from '../components/physics/climbable'
import { LostCoin } from './fx/lost-coin'
import { GameManager } from '../state/game'
import { CoyoteComponent } from '../components/input/coyote'
import { FakeDie } from './fake-die'

const SPRITE_WIDTH = 48
const SPRITE_HEIGHT = 48
const spritesheet = ex.SpriteSheet.fromImageSource({
  image: Resources.img.player,
  grid: {
    columns: 4,
    rows: 7,
    spriteWidth: SPRITE_WIDTH,
    spriteHeight: SPRITE_HEIGHT,
  },
})

export default class Player extends PhysicsActor {
  /* Constants */

  /**
   * The amount of gravity to apply to the player when they are jumping.
   */
  JUMP_GRAVITY = GRAVITY.y * 0.5

  /**
   * The amount of gravity to apply to the player when they are near the apex of their jump.
   */
  APEX_GRAVITY = GRAVITY.y * 0.3

  /**
   * The maximum speed the player can fall at.
   */
  MAX_FALL_SPEED = 270

  /**
   * The speed at which the player slides down a wall.
   */
  WALL_SLIDE_SPEED = 80

  /**
   * The speed at which the player can climb ladders.
   */
  LADDER_CLIMB_SPEED = 75

  /**
   * The amount of acceleration to apply to the player when they are walking or running.
   */
  ACCELERATION = 300

  /**
   * The amount of deceleration to apply to the player when they are stopping (i.e not hold any movement keys)
   */
  STOP_DECELERATION = this.ACCELERATION

  /**
   * The amount of deceleration to apply to the player when they are turning around on the ground.
   */
  GROUND_TURN_DECELERATION = this.ACCELERATION * 4

  /**
   * The amount of deceleration to apply to the player when they are turning around in the air.
   */
  AIR_TURN_DECELERATION = this.ACCELERATION * 7

  /**
   * The maximum velocity the player can walk at.
   */
  WALK_MAX_VELOCITY = 90

  /**
   * The maximum velocity the player can run at.
   */
  RUN_MAX_VELOCITY = 150

  /**
   * The maximum velocity the player can sprint at (triggers when running for a while)
   */
  SPRINT_MAX_VELOCITY = 210

  /**
   * The amount of time the player must be running before they can sprint.
   */
  SPRINT_TRIGGER_TIME = 1000

  /**
   * The amount of force to apply to the player when they jump while standing still or walking
   */
  JUMP_FORCE = 300

  /**
   * The amount of force to apply to the player when they jump while running
   */
  RUN_JUMP_FORCE = this.JUMP_FORCE * 1.1

  /**
   * The amount of force to apply to the player when they jump while sprinting
   */
  SPRINT_JUMP_FORCE = this.JUMP_FORCE * 1.2

  /**
   * The distance in pixels the player will move away from the wall when wall jumping
   */
  WALL_JUMP_X_DISTANCE = 4

  /**
   * The duration of how long the player will move away from the wall when wall jumping
   */
  WALL_JUMP_DURATION = 70

  /**
   * The amount of squish to apply to the player when they jump or land.
   *
   * Doing an even number divided by sprite width will ensure the player
   * squishes to a whole number of pixels.
   */
  FX_SQUISH_AMOUNT = 8 / SPRITE_WIDTH

  /* Components */

  animation = new AnimationComponent({
    idle: ex.Animation.fromSpriteSheet(spritesheet, [0, 1, 2, 3], 140),
    run: ex.Animation.fromSpriteSheet(spritesheet, [4, 5, 6, 7], 140),
    sprint: ex.Animation.fromSpriteSheet(spritesheet, [8, 9, 10, 11], 140),
    jump: ex.Animation.fromSpriteSheet(spritesheet, [12], 140),
    fall: ex.Animation.fromSpriteSheet(spritesheet, [13], 140),
    turn: ex.Animation.fromSpriteSheet(spritesheet, [16], 140),
    ladder_climb: ex.Animation.fromSpriteSheet(spritesheet, [20, 21], 140),
    wall_slide: ex.Animation.fromSpriteSheet(
      spritesheet,
      [16],
      // we're using the 'loop' strategy to play smoke effects on each loop,
      // so this is effectively the smoke fx spawn rate
      100,
      ex.AnimationStrategy.Loop
    ),
  })
  controls = new PlayerControlsComponent()

  coyote = new CoyoteComponent({
    // allow the player to jump for a short time after walking off a ledge
    jump: {
      time: 70,
      condition: () => this.isOnGround,
    },
  })

  /* State */

  /**
   * True while the user is holding the jump button or reached the
   * apex of their jump before releasing the jump button.
   */
  isUsingJumpGravity = false

  /**
   * The direction the player is facing.
   */
  facing: 'left' | 'right' = 'right'

  /**
   * True if the player is currently on a ladder.
   */
  isClimbingLadder = false

  isSlidingOnWall = false

  isWallJumping = false

  get maxXVelocity() {
    switch (true) {
      case this.controls.isSprinting:
        return this.SPRINT_MAX_VELOCITY

      case this.controls.isRunning:
        return this.RUN_MAX_VELOCITY

      default:
        return this.WALK_MAX_VELOCITY
    }
  }

  get maxFallingVelocity() {
    switch (true) {
      case this.isSlidingOnWall: {
        return this.WALL_SLIDE_SPEED
      }

      default:
        return this.MAX_FALL_SPEED
    }
  }

  get bouncepad() {
    return Array.from(this.touching.bottom).find((e) =>
      e.hasTag('bouncepad')
    ) as Bouncepad | undefined
  }

  get isTouchingLadder() {
    return this.touching.ladders.size > 0
  }

  get isAboveLadder() {
    return (
      this.raycastSide('bottom', 1, { searchAllColliders: true }).filter(
        (hit) => hit.body.owner?.has(ClimbableComponent)
      ).length > 0
    )
  }

  get isXMovementAllowed() {
    const { isBeingKnockedBack } = this.get(DamageableComponent)

    return (
      !this.isClimbingLadder &&
      !this.bouncepad &&
      !this.isWallJumping &&
      !isBeingKnockedBack
    )
  }

  constructor(args: { x: number; y: number; z?: number }) {
    super({
      ...args,
      name: 'player',
      anchor: new ex.Vector(0.5, 1),
      width: 16,
      height: 16,
      collisionType: ex.CollisionType.Active,
      collisionGroup: CollisionGroup.Player,
      collider: ex.Shape.Box(12, 12, ex.vec(0.5, 1)),
    })

    // we'll handle gravity ourselves
    this.body.useGravity = false

    const damageable = new DamageableComponent()
    this.addComponent(this.animation)
    this.addComponent(this.controls)
    this.addComponent(this.coyote)
    this.addComponent(damageable)
    this.addComponent(new HealthComponent({ amount: 3 }))

    damageable.events.on('damage', ({ amount }) => {
      if (GameManager.coins === 0) {
        if (!this.scene?.entities.find((e) => e instanceof FakeDie)) {
          this.scene?.add(
            new FakeDie({
              x: this.getGlobalPos().x,
              y: this.getGlobalPos().y,
            })
          )
        }
      } else {
        const lostCoins =
          GameManager.coins - amount < 0 ? GameManager.coins : amount
        GameManager.coins -= lostCoins

        for (let i = 0; i < lostCoins; i++) {
          this.scene?.add(
            new LostCoin({
              pos: ex.vec(
                this.facing === 'left'
                  ? this.collider.bounds.right
                  : this.collider.bounds.left,
                this.collider.bounds.top
              ),
              vel: ex.vec(100 * (this.facing === 'right' ? -1 : 1), -200),
            })
          )
        }
      }
    })

    this.animation.get('turn').events.on('frame', (frame) => {
      if (frame.frameIndex === 0) {
        AudioManager.playSfx(Resources.sfx.turnAround)
      }
    })

    this.animation.get('sprint').events.on('frame', (frame) => {
      if (frame.frameIndex % 2 === 0) {
        this.spawnSmokePuffAtFeet(
          this.facing === 'left' ? 'right' : 'left',
          ex.vec(-2, 0)
        )
      }
    })

    this.animation.get('turn').events.on('frame', (frame) => {
      this.spawnSmokePuffAtFeet(this.facing === 'left' ? 'right' : 'left')
    })

    this.animation.get('wall_slide').events.on('loop', (frame) => {
      this.spawnSmokePuffAtHands(
        this.facing,
        ex.vec(ex.randomIntInRange(-1, 1), 0)
      )
    })

    this.addTag('player')
    // for debugging
    // @ts-ignore
    window.player = this
  }

  onInitialize(engine: ex.Engine) {
    super.onInitialize(engine)

    // offset sprite to account for anchor
    this.graphics.offset = new ex.Vector(0, 16)
    this.animation.set('idle')
  }

  onPreUpdate(engine: ex.Engine, delta: number): void {
    // reset some flags when we're on the ground
    if (this.isOnGround) {
      this.isUsingJumpGravity = false
      this.isWallJumping = false
      this.isSlidingOnWall = false
    }

    if (!this.isTouchingLadder) {
      this.isClimbingLadder = false
    }

    if (!this.isOnWall('right') && !this.isOnWall('left')) {
      this.isSlidingOnWall = false
    }

    this.handleInput(engine, delta)
  }

  // @ts-ignore
  update(engine: ex.Engine<any>, delta: number): void {
    let useApexGravity = false

    // if we're jumping use our jump gravity
    if (this.vel.y < 0) {
      this.isUsingJumpGravity = this.controls.isHeld('Jump')
    }
    // if we're near the apex of our jump, use apex gravity
    if (this.isUsingJumpGravity && this.vel.y > -10 && this.vel.y < 10) {
      useApexGravity = true
    }

    // apply gravity and reset X acceleration
    if (useApexGravity) {
      this.acc.setTo(0, this.APEX_GRAVITY)
    } else if (this.isUsingJumpGravity) {
      this.acc.setTo(0, this.JUMP_GRAVITY)
    } else {
      this.acc.setTo(0, GRAVITY.y)
    }

    if (this.isClimbingLadder) {
      this.acc.setTo(0, 0)
      this.vel.setTo(0, 0)
    }

    if (this.vel.y >= this.maxFallingVelocity) {
      this.vel.y = this.maxFallingVelocity
      this.acc.y = 0
    }

    super.update(engine, delta)
  }

  onPostUpdate(engine: ex.Engine, delta: number): void {
    const { isBeingKnockedBack } = this.get(DamageableComponent)
    // speed up the animation the faster we're moving
    this.animation.speed = Math.min(
      // increase anim speed exponentially up to 3x
      1 + Math.pow(Math.abs(this.vel.x) / 200, 2) * 3,
      3
    )

    this.handleAnimation()

    if (!this.isWallJumping && !isBeingKnockedBack) {
      this.applyDeceleration()
    }
  }

  onPreCollisionResolve(
    self: ex.Collider,
    other: ex.Collider,
    side: ex.Side,
    contact: ex.CollisionContact
  ): void {
    super.onPreCollisionResolve(self, other, side, contact)

    const stompable = other.owner.has(StompableComponent)
      ? other.owner.get(StompableComponent)
      : undefined

    if (stompable) {
      const didStomp =
        stompable && !stompable.stomped && stompable.isBeingStomped(this)

      if (didStomp) {
        this.stomp(other.owner)
        contact.cancel()
      }
    }
  }

  onCollisionStart(
    self: ex.Collider,
    other: ex.Collider,
    side: ex.Side,
    contact: ex.CollisionContact
  ): void {
    if (contact.isCanceled()) {
      return
    }

    const otherBody = other.owner.get(ex.BodyComponent)

    if (
      otherBody?.collisionType === ex.CollisionType.Fixed ||
      otherBody?.collisionType === ex.CollisionType.Active
    ) {
      const wasInAir = this.oldVel.y > 0

      // player landed on the ground
      if (side === ex.Side.Bottom && wasInAir) {
        // stop moving if we landed on a bouncepad
        if (other.owner instanceof Bouncepad) {
          this.vel.x = 0
        }

        this.land()
      }
    }
  }

  /**
   * Process user input to control the character
   */
  handleInput(engine: ex.Engine, delta: number) {
    const jumpPressed = this.controls.wasPressed('Jump')
    const jumpHeld = this.controls.isHeld('Jump')

    const heldXDirection = this.controls.getHeldXDirection()
    const heldYDirection = this.controls.getHeldYDirection()

    const isCloseToLeftWall = this.isOnWall('left', 4)
    const isCloseToRightWall = this.isOnWall('right', 4)

    // move left or right
    if (heldXDirection && this.isXMovementAllowed) {
      const direction = heldXDirection === 'Left' ? -1 : 1
      const accel = this.ACCELERATION * direction

      this.facing = direction === -1 ? 'left' : 'right'

      this.acc.x += accel

      // wall slide
      if (!this.isOnGround && this.vel.y > 0) {
        const isOnRightWall = this.isOnWall('right')
        const isOnLeftWall = this.isOnWall('left')

        if (
          (isOnRightWall && heldXDirection === 'Right') ||
          (isOnLeftWall && heldXDirection === 'Left')
        ) {
          this.isSlidingOnWall = true
        } else {
          this.isSlidingOnWall = false
        }
      }
    } else {
      this.isSlidingOnWall = false
    }

    // climb ladder
    if (heldYDirection) {
      this.climbLadder()
    }

    if (jumpPressed) {
      // jump or fall off ladder
      if (this.isClimbingLadder) {
        this.isClimbingLadder = false

        // when down is held we'll just let the player fall, otherwise jump
        if (heldYDirection !== 'Down') {
          this.jump()
        }
      }
      // normal jump
      else if (this.isOnGround || this.coyote.allow('jump')) {
        this.jump()
      } else if (isCloseToLeftWall || isCloseToRightWall) {
        this.wallJump(isCloseToLeftWall ? 'left' : 'right')
      }
    }
    // cancel jump if we're not holding the jump button, but still
    // enforce a minimum jump height
    else if (
      !jumpHeld &&
      this.vel.y < 0 &&
      this.vel.y > -200 &&
      !this.isClimbingLadder
    ) {
      this.vel.y *= 0.5
      this.isUsingJumpGravity = false
    }
  }

  /**
   * Sets the player's animation based on their current state.
   */
  handleAnimation() {
    const currentFrameIndex = this.animation.current.currentFrameIndex
    const currentFrameTimeLeft = this.animation.current.currentFrameTimeLeft
    const heldDirection = this.controls.getHeldXDirection()

    this.graphics.flipHorizontal = this.facing === 'left'

    if (this.isSlidingOnWall) {
      if (!this.animation.is('wall_slide')) {
        AudioManager.playSfx(Resources.sfx.land)
      }
      this.animation.set('wall_slide')
    } else if (this.isClimbingLadder) {
      this.animation.set('ladder_climb')
      if (this.vel.y === 0) {
        this.animation.current.goToFrame(0)
      }
    } else if (this.isOnGround) {
      if (this.controls.isTurning) {
        this.animation.set('turn')
      } else {
        const isMovingInHeldDirection =
          !heldDirection ||
          (heldDirection === 'Left' && this.vel.x < 0) ||
          (heldDirection === 'Right' && this.vel.x > 0)

        if (isMovingInHeldDirection) {
          if (
            this.controls.isSprinting &&
            Math.abs(this.vel.x) > this.RUN_MAX_VELOCITY
          ) {
            const fromRunToSprint = this.animation.is('run')

            this.animation.set(
              'sprint',
              fromRunToSprint ? currentFrameIndex : 0,
              fromRunToSprint ? currentFrameTimeLeft : 0
            )
          } else if (this.vel.x !== 0) {
            const fromSprintToRun = this.animation.is('sprint')

            this.animation.set(
              'run',
              fromSprintToRun ? currentFrameIndex : 0,
              fromSprintToRun ? currentFrameTimeLeft : 0
            )
          }
        } else {
          this.animation.set('idle')
        }
      }
      // if we're not moving, play the idle animation
      if (Math.round(this.vel.x) === 0) {
        this.animation.set('idle')
      }
    } else {
      // set jump/fall animation if we're in the air
      if (this.vel.y !== 0) {
        if (this.vel.y < 0) {
          this.animation.set('jump')
        } else {
          this.animation.set('fall')
        }
      }
    }

    // apply a stretch animation when jumping
    if (this.animation.is('jump') && this.oldVel.y >= 0 && this.vel.y < 0) {
      ex.coroutine(
        this.scene!.engine,
        function* (this: Player): ReturnType<ex.CoroutineGenerator> {
          const duration = 70
          const scaleTo = 1 + 1 * this.FX_SQUISH_AMOUNT
          const easing = ex.EasingFunctions.EaseOutCubic
          const force = this.vel.y

          let elapsed = 0

          // stretch player graphic while jumping
          while (this.vel.y < force * 0.25) {
            elapsed += yield 1

            if (elapsed < duration) {
              this.squishGraphic(
                easing(Math.min(elapsed, duration), 1, scaleTo, duration)
              )
            }
          }

          elapsed = 0

          // un-stretch player graphic while jumping
          while (!this.touching.bottom.size) {
            elapsed += yield 1

            if (elapsed < duration) {
              this.squishGraphic(
                easing(Math.min(elapsed, duration), scaleTo, 1, duration * 2)
              )
            }
          }

          this.squishGraphic(1)
        }.bind(this)
      )
    }
  }

  land() {
    this.isOnGround = true
    AudioManager.playSfx(Resources.sfx.land)

    this.spawnSmoke('land', {
      pos: ex.vec(this.center.x, this.collider.bounds.bottom - 8),
      scale: ex.vec(0.5, 0.5),
    })

    // apply a squish animation when landing
    const duration = 70
    const scaleTo = 1 - this.FX_SQUISH_AMOUNT
    const easing = ex.EasingFunctions.EaseOutCubic

    ex.coroutine(
      this.scene!.engine,
      function* (this: Player): ReturnType<ex.CoroutineGenerator> {
        let elapsed = 0

        // animate squish as long as we're on the ground
        while (elapsed < duration && this.isOnGround) {
          elapsed += yield 1

          this.squishGraphic(
            easing(Math.min(elapsed, duration), 1, scaleTo, duration)
          )
        }

        this.squishGraphic(scaleTo)
        elapsed = 0

        while (elapsed < duration && this.isOnGround) {
          elapsed += yield 1

          this.squishGraphic(
            easing(Math.min(elapsed, duration), scaleTo, 1, duration)
          )
        }

        this.squishGraphic(1)
      }.bind(this)
    )
  }

  climbLadder() {
    const heldYDirection = this.controls.getHeldYDirection()

    if (this.isTouchingLadder) {
      // it's possible to be touching multiple ladder tiles at once - find the closet one
      const ladder = Array.from(this.touching.ladders)
        .sort((a, b) => {
          return (
            Math.abs(this.collider.bounds.bottom - a.collider.bounds.bottom) -
            Math.abs(this.collider.bounds.bottom - b.collider.bounds.bottom)
          )
        })
        .at(0)

      const dir = heldYDirection === 'Up' ? -1 : 1

      const isCloseEnoughOnX = Math.abs(this.pos.x - ladder!.center.x) < 8

      const toTile = (n: number) => Math.floor(Math.round(n) / 16)

      // if we're in the same tile as the ladder
      const isOccupyingSameTile =
        toTile(this.collider.bounds.bottom) ===
        toTile(ladder!.collider.bounds.bottom)

      // climb on to the ladder
      if (
        heldYDirection === 'Up' &&
        !this.isClimbingLadder &&
        isOccupyingSameTile &&
        isCloseEnoughOnX
      ) {
        this.isClimbingLadder = true
      }

      // apply climbing speed
      if (this.isClimbingLadder) {
        this.pos.x = ladder!.center.x
        this.vel.y = this.LADDER_CLIMB_SPEED * dir
        this.vel.x = 0

        // if we're on the ground, exit the ladder
        if (this.isOnGround && heldYDirection === 'Down') {
          this.isClimbingLadder = false
        }
      }
    } else if (this.isAboveLadder && heldYDirection === 'Down') {
      this.isClimbingLadder = true
      this.pos.y = Math.ceil(this.pos.y) + 1
    }
  }

  /**
   * Applies a jump force to the player.
   */
  jump(force?: number, playSfx = true) {
    // this will be correctly set at the beginning of each frame, but we want to update it for the remainder
    // of this frame incase any logic depends on it (e.g. animations)
    this.isOnGround = false
    this.coyote.reset('jump')

    // if we're on a bouncepad, trigger it to release immediately
    if (this.bouncepad) {
      this.bouncepad.release()
      return
    }

    if (force === undefined) {
      force = this.JUMP_FORCE

      if (this.controls.isSprinting) {
        force = this.SPRINT_JUMP_FORCE
      } else if (this.controls.isRunning) {
        force = this.RUN_JUMP_FORCE
      }
    }

    this.vel.y = -force

    if (playSfx) {
      AudioManager.playSfx(Resources.sfx.jump)
    }
  }

  wallJump(side: 'left' | 'right') {
    if (this.isWallJumping) return
    this.jump()
    this.isWallJumping = true
    this.spawnSmokePuffAtFeet(side, ex.vec(0, -4))

    ex.coroutine(
      this.scene!.engine,
      function* (this: Player): ReturnType<ex.CoroutineGenerator> {
        let elapsed = 0

        const dir = side === 'left' ? 1 : -1
        // get velocity (px/second) so that WALL_JUMP_X_DISTANCE is reached in WALL_JUMP_DURATION
        const wallJumpVel =
          (this.WALL_JUMP_X_DISTANCE / (this.WALL_JUMP_DURATION / 1000)) * dir

        while (elapsed < this.WALL_JUMP_DURATION && this.isWallJumping) {
          elapsed += yield 1
          this.vel.x = wallJumpVel
        }

        if (this.isWallJumping) {
          const heldXDirection = this.controls.getHeldXDirection()

          if (!heldXDirection) {
            this.vel.x = 0
          }
        }

        this.isWallJumping = false
      }.bind(this)
    )
  }

  stomp(other: ex.Entity) {
    const killable = other.get(KillableComponent)

    if (killable.dead) return

    this.land()
    killable.kill('stomp')
    AudioManager.playSfx(Resources.sfx.stomp)

    // use a higher jump force unless we're sprinting
    const force = !this.controls.isSprinting
      ? this.RUN_JUMP_FORCE
      : this.SPRINT_JUMP_FORCE

    this.jump(force, false)
  }

  isOnWall(side: 'left' | 'right', distance = 1) {
    const hits = this.raycastSide(side, distance, {
      filter: (hit) => hit.body.group === CollisionGroup.Ground,
    })

    return hits.length > 0
  }

  /**
   * Applies ground friction to the player's velocity.
   */
  applyDeceleration() {
    const isOnGround = this.isOnGround
    const isOverMaxXVelocity = Math.abs(this.vel.x) > this.maxXVelocity

    // ground deceleration
    if (isOnGround) {
      // apply turn deceleration if we're turning
      if (this.controls.isTurning) {
        this.acc.x = -this.GROUND_TURN_DECELERATION * Math.sign(this.vel.x)
      }
      // decelerate if we're over the max velocity or stopped walking
      else if (!this.controls.isMoving || isOverMaxXVelocity) {
        if (this.vel.x !== 0) {
          this.acc.x = -this.STOP_DECELERATION * Math.sign(this.vel.x)
        }
      }
    }
    // air deceleration
    else {
      if (this.controls.isTurning) {
        this.acc.x = -this.AIR_TURN_DECELERATION * Math.sign(this.vel.x)
      } else if (isOverMaxXVelocity) {
        // in air, clamp to max velocity
        this.vel.x = ex.clamp(this.vel.x, -this.maxXVelocity, this.maxXVelocity)
        this.acc.x = 0
      }
    }

    const isDecelerating =
      Math.sign(this.vel.x) !== 0 &&
      Math.sign(this.vel.x) !== Math.sign(this.acc.x)
    // clamp to 0 if we're close enough
    if (isDecelerating && Math.abs(this.vel.x) < 1) {
      this.vel.x = 0
      this.acc.x = 0
    }
  }

  /**
   * Squishes the player's graphic by a scale factor. If below 1, it will
   * squash the player, if above 1, it will stretch the player.
   */
  squishGraphic(scale: number) {
    const y = scale
    const x = 2 - y
    this.graphics.current!.scale = ex.vec(x, y)
  }

  spawnSmoke(
    type: 'puff' | 'land',
    args: { pos: ex.Vector; scale?: ex.Vector }
  ) {
    this.scene?.add(
      new Smoke({
        type,
        z: this.z + 1,
        ...args,
      })
    )
  }

  spawnSmokePuffAtFeet(side: 'left' | 'right', offset = ex.vec(0, 0)) {
    this.spawnSmoke('puff', {
      pos: ex.vec(
        side === 'left'
          ? this.collider.bounds.left + offset.x
          : this.collider.bounds.right - offset.x,
        this.collider.bounds.bottom + offset.y
      ),
      scale: ex.vec(0.35, 0.35),
    })
  }

  spawnSmokePuffAtHands(side: 'left' | 'right', offset = ex.vec(0, 0)) {
    this.spawnSmoke('puff', {
      pos: ex.vec(
        side === 'left'
          ? this.collider.bounds.left + offset.x
          : this.collider.bounds.right - offset.x,
        this.center.y + offset.y
      ),
      scale: ex.vec(0.35, 0.35),
    })
  }
}

/**
 * Handles user input for the player, adding some extra helper methods
 * to get the intent of movement via input.
 *
 * For example, `isMoving` returns true if the player is holding left or right, but
 * does not necessarily mean the player is actually moving.
 */
class PlayerControlsComponent extends ControlsComponent {
  declare owner: Player

  sprintTimer = 0

  onAdd(owner: Player): void {
    super.onAdd?.(owner)

    // increment the sprint timer to toggle sprinting if we're running for SPRINT_TRIGGER_TIME
    owner.on('postupdate', ({ delta }) => {
      const isOnGround = this.owner.isOnGround
      const jumpedBeforeSprinting = !isOnGround && !this.isSprinting
      const isTurningOnGround = this.isTurning && isOnGround

      if (this.isRunning && isOnGround && !isTurningOnGround) {
        this.sprintTimer = Math.min(
          this.sprintTimer + delta,
          this.owner.SPRINT_TRIGGER_TIME
        )
      }
      // reset the sprint timer if we're not running
      else if (!this.isRunning || isTurningOnGround || jumpedBeforeSprinting) {
        this.sprintTimer = 0
      }
    })
  }

  get isMoving() {
    return this.getHeldXDirection() !== undefined
  }

  get isRunning() {
    return this.isMoving && this.isHeld('Run')
  }

  get isSprinting() {
    return this.isRunning && this.sprintTimer >= this.owner.SPRINT_TRIGGER_TIME
  }

  get isTurning() {
    const heldDirection = this.getHeldXDirection()
    const { isBeingKnockedBack } = this.owner.get(DamageableComponent)

    if (isBeingKnockedBack) return false

    return (
      (heldDirection === 'Left' && this.owner.vel.x > 0) ||
      (heldDirection === 'Right' && this.owner.vel.x < 0)
    )
  }
}
