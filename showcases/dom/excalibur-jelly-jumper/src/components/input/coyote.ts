import * as ex from 'excalibur';

interface CoyoteAction {
    time: number;

    /**
     * Called on the owner's preupdate. True refills this action's counter to `time`; false counts it
     * down by the elapsed milliseconds.
     */
    condition: (dt: number) => boolean;
}

/**
 * A grace period for any action — canonically jumping, so a player who has just walked off a ledge
 * can still jump for a few frames.
 */
export class CoyoteComponent<T extends Record<string, CoyoteAction>> extends ex.Component {
    actions: T;

    // oxlint-disable-next-line typescript/no-explicit-any -- {} cast required as Record<keyof T, number> because T is a generic constrained by object; TypeScript cannot verify keys at init
    counter: Record<keyof T, number> = {} as any;

    constructor(actions: T) {
        super();
        this.actions = actions;
    }

    // oxlint-disable-next-line typescript/no-explicit-any -- ex.Entity<any> is Excalibur's Component.onAdd() signature; Entity uses any generic
    onAdd(owner: ex.Entity<any>): void {
        owner.on('preupdate', this.onPreUpdate.bind(this));
    }

    onPreUpdate(ev: ex.PreUpdateEvent) {
        for (const action in this.actions) {
            const coyote = this.actions[action];
            if (coyote.condition(ev.elapsed)) {
                this.counter[action] = coyote.time;
            } else {
                this.counter[action] = Math.max(0, this.counter[action] - ev.elapsed);
            }
        }
    }

    allow(action: keyof T) {
        return this.counter[action] > 0;
    }

    reset(action: keyof T) {
        this.counter[action] = 0;
    }
}
