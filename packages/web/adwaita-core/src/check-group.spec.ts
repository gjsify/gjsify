// The check-group core against the shared vectors, on a minimal button that keeps `active` itself
// the way a port does, plus what only the core sees.

import { describe, expect, it } from '@gjsify/unit';

import { checkActivationFlips, checkGroupNeighbours, isRadioCheck, setCheckGroup } from './check-group.js';
import { driveCheckGroupVectors, type CheckButtonLike } from './conformance/check-group.js';

class FakeCheck implements CheckButtonLike {
    #active = false;
    toggled = 0;
    get active(): boolean {
        return this.#active;
    }
    set active(value: boolean) {
        if (value === this.#active) return;
        if (value) for (const other of checkGroupNeighbours(this)) other.active = false;
        this.#active = value;
        this.toggled += 1;
    }
    get_active(): boolean {
        return this.#active;
    }
    set_active(value: boolean): void {
        this.active = value;
    }
    set_group(group: CheckButtonLike | null): void {
        setCheckGroup(this, group);
    }
}

export default async () => {
    await driveCheckGroupVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            make: () => new FakeCheck(),
            activate(button) {
                if (checkActivationFlips(button, button.active)) button.active = !button.active;
            },
            countToggled(button) {
                const from = (button as FakeCheck).toggled;
                return () => (button as FakeCheck).toggled - from;
            },
        },
        { describe, it, expect },
    );

    await describe('adwaita-core: Gtk.CheckButton group', async () => {
        await it('joining makes both buttons radios, leaving makes only the leaver a check again', () => {
            const [a, b] = [new FakeCheck(), new FakeCheck()];
            b.set_group(a);
            const joined = [isRadioCheck(a), isRadioCheck(b)];
            b.set_group(null);
            expect(JSON.stringify([...joined, isRadioCheck(a), isRadioCheck(b)])).toBe('[true,true,true,false]');
        });
        await it('a button is in one group at a time', () => {
            const [a, b, c] = [new FakeCheck(), new FakeCheck(), new FakeCheck()];
            c.set_group(a);
            c.set_group(b);
            expect(checkGroupNeighbours(a).length).toBe(0);
            expect(checkGroupNeighbours(c)[0]).toBe(b);
        });
        await it('refuses a button as its own group', () => {
            const a = new FakeCheck();
            expect(() => a.set_group(a)).toThrow();
        });
    });
};
