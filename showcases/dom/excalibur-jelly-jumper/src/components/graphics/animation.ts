import * as ex from 'excalibur';

/** Keyed animations for an actor, with a speed multiplier applied across their frames. */
export class AnimationComponent<Keys extends string> extends ex.Component {
    declare owner: ex.Entity & { graphics: ex.GraphicsComponent };

    type = 'animation';

    private _animations: Record<Keys, ex.Animation>;
    private _speed = 1;
    private _frameDurations = new WeakMap<ex.Frame, number>();

    constructor(animations: Record<Keys, ex.Animation>) {
        super();
        this._animations = animations;
    }

    /** Starts the named animation from the beginning, or does nothing if it is already playing. */
    set(name: Keys, startFromFrame = 0, durationLeft?: number) {
        const prevAnim = this.owner.graphics.current;
        const anim = this._animations[name];

        if (this.is(name)) return;

        if (startFromFrame) {
            anim.goToFrame(startFromFrame, durationLeft);
        } else {
            anim.reset();
        }

        // Scale and opacity carry over so a mid-jump squish is not lost on an animation switch.
        if (prevAnim) {
            anim.scale.setTo(prevAnim.scale.x, prevAnim.scale.y);
            anim.opacity = prevAnim.opacity;
        }

        this.owner.graphics.use(anim);
    }

    get(name: Keys) {
        return this._animations[name];
    }

    /** 1 is normal, 2 is double. Frame durations are divided by it. */
    set speed(value: number) {
        this._speed = value;

        if (value === 0) return;

        this.current.frames.forEach((frame) => {
            // The FIRST duration seen is the baseline; dividing the live one would compound.
            if (!this._frameDurations.has(frame)) {
                this._frameDurations.set(frame, frame.duration ?? 0);
            }

            const baseDuration = this._frameDurations.get(frame)!;
            frame.duration = baseDuration / value;
        });
    }

    get speed() {
        return this._speed;
    }

    get current() {
        return this.owner.graphics.current as ex.Animation;
    }

    is(animation: Keys) {
        return this.current === this.get(animation);
    }
}
