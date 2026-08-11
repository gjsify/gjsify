import * as ex from 'excalibur';
import { Resources } from '../resources.js';
import { AnimationComponent } from '../components/graphics/animation.js';
import { ControlsComponent } from '../components/input/controls.js';
import { PhysicsActor } from '../classes/physics-actor.js';
import { AudioManager } from '../state/audio.js';
import { GRAVITY } from '../physics/gravity.js';
import { Bouncepad } from './platforms/bouncepad.js';
import { StompableComponent } from '../components/behaviours/stompable.js';
import { KillableComponent } from '../components/behaviours/killable.js';
import { CollisionGroup } from '../physics/collision.js';
import { Smoke } from './fx/smoke.js';
import { HealthComponent } from '../components/behaviours/health.js';
import { DamageableComponent } from '../components/behaviours/damageable.js';
import { ClimbableComponent } from '../components/physics/climbable.js';
import { LostCoin } from './fx/lost-coin.js';
import { GameManager } from '../state/game.js';
import { CoyoteComponent } from '../components/input/coyote.js';
import { FakeDie } from './fake-die.js';

const SPRITE_WIDTH = 48;
const SPRITE_HEIGHT = 48;
const spritesheet = ex.SpriteSheet.fromImageSource({
    image: Resources.img.player,
    grid: {
        columns: 4,
        rows: 7,
        spriteWidth: SPRITE_WIDTH,
        spriteHeight: SPRITE_HEIGHT,
    },
});

export default class Player extends PhysicsActor {
    JUMP_GRAVITY = GRAVITY.y * 0.5;
    APEX_GRAVITY = GRAVITY.y * 0.3;
    MAX_FALL_SPEED = 270;
    WALL_SLIDE_SPEED = 80;
    LADDER_CLIMB_SPEED = 75;
    ACCELERATION = 300;

    /** Applied when no movement key is held. */
    STOP_DECELERATION = this.ACCELERATION;
    GROUND_TURN_DECELERATION = this.ACCELERATION * 4;
    AIR_TURN_DECELERATION = this.ACCELERATION * 7;

    WALK_MAX_VELOCITY = 90;
    RUN_MAX_VELOCITY = 150;
    SPRINT_MAX_VELOCITY = 210;

    /** How long the player must run before sprinting starts, in ms. */
    SPRINT_TRIGGER_TIME = 1000;

    JUMP_FORCE = 300;
    RUN_JUMP_FORCE = this.JUMP_FORCE * 1.1;
    SPRINT_JUMP_FORCE = this.JUMP_FORCE * 1.2;

    /** Pixels pushed away from the wall on a wall jump, and for how many ms. */
    WALL_JUMP_X_DISTANCE = 4;
    WALL_JUMP_DURATION = 70;

    /** An EVEN numerator keeps the squish a whole number of pixels wide. */
    FX_SQUISH_AMOUNT = 8 / SPRITE_WIDTH;

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
            ex.AnimationStrategy.Loop,
        ),
    });
    controls = new PlayerControlsComponent();

    coyote = new CoyoteComponent({
        // allow the player to jump for a short time after walking off a ledge
        jump: {
            time: 70,
            condition: () => this.isOnGround,
        },
    });

    /** Set while the jump button is held, and once the apex is reached even after release. */
    isUsingJumpGravity = false;

    facing: 'left' | 'right' = 'right';

    isClimbingLadder = false;

    isSlidingOnWall = false;

    isWallJumping = false;

    get maxXVelocity() {
        switch (true) {
            case this.controls.isSprinting:
                return this.SPRINT_MAX_VELOCITY;

            case this.controls.isRunning:
                return this.RUN_MAX_VELOCITY;

            default:
                return this.WALK_MAX_VELOCITY;
        }
    }

    get maxFallingVelocity() {
        switch (true) {
            case this.isSlidingOnWall: {
                return this.WALL_SLIDE_SPEED;
            }

            default:
                return this.MAX_FALL_SPEED;
        }
    }

    get bouncepad() {
        for (const e of this.touching.bottom) {
            if (e.hasTag('bouncepad')) return e as Bouncepad;
        }
        return undefined;
    }

    get isTouchingLadder() {
        return this.touching.ladders.size > 0;
    }

    get isAboveLadder() {
        return (
            this.raycastSide('bottom', 1, { searchAllColliders: true }).filter((hit) =>
                hit.body.owner?.has(ClimbableComponent),
            ).length > 0
        );
    }

    get isXMovementAllowed() {
        const { isBeingKnockedBack } = this.get(DamageableComponent);

        return !this.isClimbingLadder && !this.bouncepad && !this.isWallJumping && !isBeingKnockedBack;
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
        } as ex.ActorArgs);

        // we'll handle gravity ourselves
        this.body.useGravity = false;

        const damageable = new DamageableComponent();
        this.addComponent(this.animation);
        this.addComponent(this.controls);
        this.addComponent(this.coyote);
        this.addComponent(damageable);
        this.addComponent(new HealthComponent({ amount: 3 }));

        damageable.events.on('damage', ({ amount }) => {
            if (GameManager.coins === 0) {
                if (!this.scene?.entities.find((e) => e instanceof FakeDie)) {
                    this.scene?.add(
                        new FakeDie({
                            x: this.getGlobalPos().x,
                            y: this.getGlobalPos().y,
                        }),
                    );
                }
            } else {
                const lostCoins = GameManager.coins - amount < 0 ? GameManager.coins : amount;
                GameManager.coins -= lostCoins;

                for (let i = 0; i < lostCoins; i++) {
                    this.scene?.add(
                        new LostCoin({
                            pos: ex.vec(
                                this.facing === 'left' ? this.collider.bounds.right : this.collider.bounds.left,
                                this.collider.bounds.top,
                            ),
                            vel: ex.vec(100 * (this.facing === 'right' ? -1 : 1), -200),
                        }),
                    );
                }
            }
        });

        this.animation.get('turn').events.on('frame', (frame) => {
            if (frame.frameIndex === 0) {
                AudioManager.playSfx(Resources.sfx.turnAround);
            }
        });

        this.animation.get('sprint').events.on('frame', (frame) => {
            if (frame.frameIndex % 2 === 0) {
                this.spawnSmokePuffAtFeet(this.facing === 'left' ? 'right' : 'left', ex.vec(-2, 0));
            }
        });

        this.animation.get('turn').events.on('frame', (_frame) => {
            this.spawnSmokePuffAtFeet(this.facing === 'left' ? 'right' : 'left');
        });

        this.animation.get('wall_slide').events.on('loop', (_frame) => {
            this.spawnSmokePuffAtHands(this.facing, ex.vec(ex.randomIntInRange(-1, 1), 0));
        });

        this.addTag('player');
        // for debugging
        // @ts-ignore
        window.player = this;
    }

    onInitialize(engine: ex.Engine) {
        super.onInitialize(engine);

        // offset sprite to account for anchor
        this.graphics.offset = new ex.Vector(0, 16);
        this.animation.set('idle');
    }

    onPreUpdate(engine: ex.Engine, elapsed: number): void {
        if (this.isOnGround) {
            this.isUsingJumpGravity = false;
            this.isWallJumping = false;
            this.isSlidingOnWall = false;
        }

        if (!this.isTouchingLadder) {
            this.isClimbingLadder = false;
        }

        if (!this.isOnWall('right') && !this.isOnWall('left')) {
            this.isSlidingOnWall = false;
        }

        this.handleInput(engine, elapsed);
    }

    // @ts-ignore
    // oxlint-disable-next-line typescript/no-explicit-any -- ex.Engine<any> uses Excalibur default generic; Engine<TKnownScenes = any>
    update(engine: ex.Engine<any>, elapsed: number): void {
        let useApexGravity = false;

        if (this.vel.y < 0) {
            this.isUsingJumpGravity = this.controls.isHeld('Jump');
        }
        if (this.isUsingJumpGravity && this.vel.y > -10 && this.vel.y < 10) {
            useApexGravity = true;
        }

        if (useApexGravity) {
            this.acc.setTo(0, this.APEX_GRAVITY);
        } else if (this.isUsingJumpGravity) {
            this.acc.setTo(0, this.JUMP_GRAVITY);
        } else {
            this.acc.setTo(0, GRAVITY.y);
        }

        if (this.isClimbingLadder) {
            this.acc.setTo(0, 0);
            this.vel.setTo(0, 0);
        }

        if (this.vel.y >= this.maxFallingVelocity) {
            this.vel.y = this.maxFallingVelocity;
            this.acc.y = 0;
        }

        super.update(engine, elapsed);
    }

    onPostUpdate(_engine: ex.Engine, _elapsed: number): void {
        const { isBeingKnockedBack } = this.get(DamageableComponent);
        this.animation.speed = Math.min(
            // increase anim speed exponentially up to 3x
            1 + Math.pow(Math.abs(this.vel.x) / 200, 2) * 3,
            3,
        );

        this.handleAnimation();

        if (!this.isWallJumping && !isBeingKnockedBack) {
            this.applyDeceleration();
        }
    }

    onPreCollisionResolve(self: ex.Collider, other: ex.Collider, side: ex.Side, contact: ex.CollisionContact): void {
        super.onPreCollisionResolve(self, other, side, contact);

        const stompable = other.owner.has(StompableComponent) ? other.owner.get(StompableComponent) : undefined;

        if (stompable) {
            const didStomp = stompable && !stompable.stomped && stompable.isBeingStomped(this);

            if (didStomp) {
                this.stomp(other.owner);
                contact.cancel();
            }
        }
    }

    onCollisionStart(self: ex.Collider, other: ex.Collider, side: ex.Side, contact: ex.CollisionContact): void {
        if (contact.isCanceled()) {
            return;
        }

        const otherBody = other.owner.get(ex.BodyComponent);

        if (
            otherBody?.collisionType === ex.CollisionType.Fixed ||
            otherBody?.collisionType === ex.CollisionType.Active
        ) {
            const wasInAir = this.oldVel.y > 0;

            if (side === ex.Side.Bottom && wasInAir) {
                if (other.owner instanceof Bouncepad) {
                    this.vel.x = 0;
                }

                this.land();
            }
        }
    }

    handleInput(_engine: ex.Engine, _elapsed: number) {
        const jumpPressed = this.controls.wasPressed('Jump');
        const jumpHeld = this.controls.isHeld('Jump');

        const heldXDirection = this.controls.getHeldXDirection();
        const heldYDirection = this.controls.getHeldYDirection();

        const isCloseToLeftWall = this.isOnWall('left', 4);
        const isCloseToRightWall = this.isOnWall('right', 4);

        if (heldXDirection && this.isXMovementAllowed) {
            const direction = heldXDirection === 'Left' ? -1 : 1;
            const accel = this.ACCELERATION * direction;

            this.facing = direction === -1 ? 'left' : 'right';

            this.acc.x += accel;

            if (!this.isOnGround && this.vel.y > 0) {
                const isOnRightWall = this.isOnWall('right');
                const isOnLeftWall = this.isOnWall('left');

                if ((isOnRightWall && heldXDirection === 'Right') || (isOnLeftWall && heldXDirection === 'Left')) {
                    this.isSlidingOnWall = true;
                } else {
                    this.isSlidingOnWall = false;
                }
            }
        } else {
            this.isSlidingOnWall = false;
        }

        if (heldYDirection) {
            this.climbLadder();
        }

        if (jumpPressed) {
            if (this.isClimbingLadder) {
                this.isClimbingLadder = false;

                // when down is held we'll just let the player fall, otherwise jump
                if (heldYDirection !== 'Down') {
                    this.jump();
                }
            } else if (this.isOnGround || this.coyote.allow('jump')) {
                this.jump();
            } else if (isCloseToLeftWall || isCloseToRightWall) {
                this.wallJump(isCloseToLeftWall ? 'left' : 'right');
            }
        }
        // cancel jump if we're not holding the jump button, but still
        // enforce a minimum jump height
        else if (!jumpHeld && this.vel.y < 0 && this.vel.y > -200 && !this.isClimbingLadder) {
            this.vel.y *= 0.5;
            this.isUsingJumpGravity = false;
        }
    }

    handleAnimation() {
        const currentFrameIndex = this.animation.current.currentFrameIndex;
        const currentFrameTimeLeft = this.animation.current.currentFrameTimeLeft;
        const heldDirection = this.controls.getHeldXDirection();

        this.graphics.flipHorizontal = this.facing === 'left';

        if (this.isSlidingOnWall) {
            if (!this.animation.is('wall_slide')) {
                AudioManager.playSfx(Resources.sfx.land);
            }
            this.animation.set('wall_slide');
        } else if (this.isClimbingLadder) {
            this.animation.set('ladder_climb');
            if (this.vel.y === 0) {
                this.animation.current.goToFrame(0);
            }
        } else if (this.isOnGround) {
            if (this.controls.isTurning) {
                this.animation.set('turn');
            } else {
                const isMovingInHeldDirection =
                    !heldDirection ||
                    (heldDirection === 'Left' && this.vel.x < 0) ||
                    (heldDirection === 'Right' && this.vel.x > 0);

                if (isMovingInHeldDirection) {
                    if (this.controls.isSprinting && Math.abs(this.vel.x) > this.RUN_MAX_VELOCITY) {
                        const fromRunToSprint = this.animation.is('run');

                        this.animation.set(
                            'sprint',
                            fromRunToSprint ? currentFrameIndex : 0,
                            fromRunToSprint ? currentFrameTimeLeft : 0,
                        );
                    } else if (this.vel.x !== 0) {
                        const fromSprintToRun = this.animation.is('sprint');

                        this.animation.set(
                            'run',
                            fromSprintToRun ? currentFrameIndex : 0,
                            fromSprintToRun ? currentFrameTimeLeft : 0,
                        );
                    }
                } else {
                    this.animation.set('idle');
                }
            }
            if (Math.round(this.vel.x) === 0) {
                this.animation.set('idle');
            }
        } else {
            if (this.vel.y !== 0) {
                if (this.vel.y < 0) {
                    this.animation.set('jump');
                } else {
                    this.animation.set('fall');
                }
            }
        }

        if (this.animation.is('jump') && this.oldVel.y >= 0 && this.vel.y < 0) {
            ex.coroutine(
                this.scene!.engine,
                function* (this: Player): ReturnType<ex.CoroutineGenerator> {
                    const duration = 70;
                    const scaleTo = 1 + 1 * this.FX_SQUISH_AMOUNT;
                    const easing = ex.EasingFunctions.EaseOutCubic;
                    const force = this.vel.y;

                    let elapsed = 0;

                    while (this.vel.y < force * 0.25) {
                        elapsed += yield 1;

                        if (elapsed < duration) {
                            this.squishGraphic(easing(Math.min(elapsed, duration), 1, scaleTo, duration));
                        }
                    }

                    elapsed = 0;

                    while (!this.touching.bottom.size) {
                        elapsed += yield 1;

                        if (elapsed < duration) {
                            this.squishGraphic(easing(Math.min(elapsed, duration), scaleTo, 1, duration * 2));
                        }
                    }

                    this.squishGraphic(1);
                }.bind(this),
            );
        }
    }

    land() {
        this.isOnGround = true;
        AudioManager.playSfx(Resources.sfx.land);

        this.spawnSmoke('land', {
            pos: ex.vec(this.center.x, this.collider.bounds.bottom - 8),
            scale: ex.vec(0.5, 0.5),
        });

        const duration = 70;
        const scaleTo = 1 - this.FX_SQUISH_AMOUNT;
        const easing = ex.EasingFunctions.EaseOutCubic;

        ex.coroutine(
            this.scene!.engine,
            function* (this: Player): ReturnType<ex.CoroutineGenerator> {
                let elapsed = 0;

                while (elapsed < duration && this.isOnGround) {
                    elapsed += yield 1;

                    this.squishGraphic(easing(Math.min(elapsed, duration), 1, scaleTo, duration));
                }

                this.squishGraphic(scaleTo);
                elapsed = 0;

                while (elapsed < duration && this.isOnGround) {
                    elapsed += yield 1;

                    this.squishGraphic(easing(Math.min(elapsed, duration), scaleTo, 1, duration));
                }

                this.squishGraphic(1);
            }.bind(this),
        );
    }

    climbLadder() {
        const heldYDirection = this.controls.getHeldYDirection();

        if (this.isTouchingLadder) {
            // Multiple ladder tiles can be touched at once; take the closest.
            const ladder = Array.from(this.touching.ladders)
                .sort((a, b) => {
                    return (
                        Math.abs(this.collider.bounds.bottom - a.collider.bounds.bottom) -
                        Math.abs(this.collider.bounds.bottom - b.collider.bounds.bottom)
                    );
                })
                .at(0);

            const dir = heldYDirection === 'Up' ? -1 : 1;

            const isCloseEnoughOnX = Math.abs(this.pos.x - ladder!.center.x) < 8;

            const toTile = (n: number) => Math.floor(Math.round(n) / 16);

            const isOccupyingSameTile = toTile(this.collider.bounds.bottom) === toTile(ladder!.collider.bounds.bottom);

            if (heldYDirection === 'Up' && !this.isClimbingLadder && isOccupyingSameTile && isCloseEnoughOnX) {
                this.isClimbingLadder = true;
            }

            if (this.isClimbingLadder) {
                this.pos.x = ladder!.center.x;
                this.vel.y = this.LADDER_CLIMB_SPEED * dir;
                this.vel.x = 0;

                if (this.isOnGround && heldYDirection === 'Down') {
                    this.isClimbingLadder = false;
                }
            }
        } else if (this.isAboveLadder && heldYDirection === 'Down') {
            this.isClimbingLadder = true;
            this.pos.y = Math.ceil(this.pos.y) + 1;
        }
    }

    jump(force?: number, playSfx = true) {
        // Set here as well as at the start of each frame, so logic later in THIS frame (animations)
        // sees it.
        this.isOnGround = false;
        this.coyote.reset('jump');

        if (this.bouncepad) {
            this.bouncepad.release();
            return;
        }

        if (force === undefined) {
            force = this.JUMP_FORCE;

            if (this.controls.isSprinting) {
                force = this.SPRINT_JUMP_FORCE;
            } else if (this.controls.isRunning) {
                force = this.RUN_JUMP_FORCE;
            }
        }

        this.vel.y = -force;

        if (playSfx) {
            AudioManager.playSfx(Resources.sfx.jump);
        }
    }

    wallJump(side: 'left' | 'right') {
        if (this.isWallJumping) return;
        this.jump();
        this.isWallJumping = true;
        this.spawnSmokePuffAtFeet(side, ex.vec(0, -4));

        ex.coroutine(
            this.scene!.engine,
            function* (this: Player): ReturnType<ex.CoroutineGenerator> {
                let elapsed = 0;

                const dir = side === 'left' ? 1 : -1;
                // get velocity (px/second) so that WALL_JUMP_X_DISTANCE is reached in WALL_JUMP_DURATION
                const wallJumpVel = (this.WALL_JUMP_X_DISTANCE / (this.WALL_JUMP_DURATION / 1000)) * dir;

                while (elapsed < this.WALL_JUMP_DURATION && this.isWallJumping) {
                    elapsed += yield 1;
                    this.vel.x = wallJumpVel;
                }

                if (this.isWallJumping) {
                    const heldXDirection = this.controls.getHeldXDirection();

                    if (!heldXDirection) {
                        this.vel.x = 0;
                    }
                }

                this.isWallJumping = false;
            }.bind(this),
        );
    }

    stomp(other: ex.Entity) {
        const killable = other.get(KillableComponent);

        if (killable.dead) return;

        this.land();
        killable.kill('stomp');
        AudioManager.playSfx(Resources.sfx.stomp);

        const force = !this.controls.isSprinting ? this.RUN_JUMP_FORCE : this.SPRINT_JUMP_FORCE;

        this.jump(force, false);
    }

    isOnWall(side: 'left' | 'right', distance = 1) {
        const hits = this.raycastSide(side, distance, {
            filter: (hit) => hit.body.group === CollisionGroup.Ground,
        });

        return hits.length > 0;
    }

    applyDeceleration() {
        const isOnGround = this.isOnGround;
        const isOverMaxXVelocity = Math.abs(this.vel.x) > this.maxXVelocity;

        if (isOnGround) {
            if (this.controls.isTurning) {
                this.acc.x = -this.GROUND_TURN_DECELERATION * Math.sign(this.vel.x);
            } else if (!this.controls.isMoving || isOverMaxXVelocity) {
                if (this.vel.x !== 0) {
                    this.acc.x = -this.STOP_DECELERATION * Math.sign(this.vel.x);
                }
            }
        } else {
            if (this.controls.isTurning) {
                this.acc.x = -this.AIR_TURN_DECELERATION * Math.sign(this.vel.x);
            } else if (isOverMaxXVelocity) {
                this.vel.x = ex.clamp(this.vel.x, -this.maxXVelocity, this.maxXVelocity);
                this.acc.x = 0;
            }
        }

        const isDecelerating = Math.sign(this.vel.x) !== 0 && Math.sign(this.vel.x) !== Math.sign(this.acc.x);
        if (isDecelerating && Math.abs(this.vel.x) < 1) {
            this.vel.x = 0;
            this.acc.x = 0;
        }
    }

    /** Below 1 squashes, above 1 stretches; the other axis compensates so area stays roughly equal. */
    squishGraphic(scale: number) {
        const y = scale;
        const x = 2 - y;
        this.graphics.current!.scale = ex.vec(x, y);
    }

    spawnSmoke(type: 'puff' | 'land', args: { pos: ex.Vector; scale?: ex.Vector }) {
        this.scene?.add(
            new Smoke({
                type,
                z: this.z + 1,
                ...args,
            }),
        );
    }

    spawnSmokePuffAtFeet(side: 'left' | 'right', offset = ex.vec(0, 0)) {
        this.spawnSmoke('puff', {
            pos: ex.vec(
                side === 'left' ? this.collider.bounds.left + offset.x : this.collider.bounds.right - offset.x,
                this.collider.bounds.bottom + offset.y,
            ),
            scale: ex.vec(0.35, 0.35),
        });
    }

    spawnSmokePuffAtHands(side: 'left' | 'right', offset = ex.vec(0, 0)) {
        this.spawnSmoke('puff', {
            pos: ex.vec(
                side === 'left' ? this.collider.bounds.left + offset.x : this.collider.bounds.right - offset.x,
                this.center.y + offset.y,
            ),
            scale: ex.vec(0.35, 0.35),
        });
    }
}

/**
 * Player input, exposing INTENT rather than state: `isMoving` is true while left or right is held,
 * whether or not the player actually moves.
 */
class PlayerControlsComponent extends ControlsComponent {
    declare owner: Player;

    sprintTimer = 0;

    onAdd(owner: Player): void {
        super.onAdd?.(owner);

        owner.on('postupdate', ({ elapsed }) => {
            const isOnGround = this.owner.isOnGround;
            const jumpedBeforeSprinting = !isOnGround && !this.isSprinting;
            const isTurningOnGround = this.isTurning && isOnGround;

            if (this.isRunning && isOnGround && !isTurningOnGround) {
                this.sprintTimer = Math.min(this.sprintTimer + elapsed, this.owner.SPRINT_TRIGGER_TIME);
            } else if (!this.isRunning || isTurningOnGround || jumpedBeforeSprinting) {
                this.sprintTimer = 0;
            }
        });
    }

    get isMoving() {
        return this.getHeldXDirection() !== undefined;
    }

    get isRunning() {
        return this.isMoving && this.isHeld('Run');
    }

    get isSprinting() {
        return this.isRunning && this.sprintTimer >= this.owner.SPRINT_TRIGGER_TIME;
    }

    get isTurning() {
        const heldDirection = this.getHeldXDirection();
        const { isBeingKnockedBack } = this.owner.get(DamageableComponent);

        if (isBeingKnockedBack) return false;

        return (
            (heldDirection === 'Left' && this.owner.vel.x > 0) || (heldDirection === 'Right' && this.owner.vel.x < 0)
        );
    }
}
