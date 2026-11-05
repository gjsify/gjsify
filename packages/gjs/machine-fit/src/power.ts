/**
 * Is the machine running on its battery? A probe must not run then (ADR 0127 decision 12), and
 * long background work may want to pause.
 *
 * Linux from sysfs, because that is where it costs nothing: no D-Bus, no dependency. macOS has no
 * sysfs and answers through `pmset`. Anywhere else the answer is "no" — an unknown is not a reason
 * to stop working.
 */

import { join } from 'node:path';

import { systemProbe, type MachineProbe } from './machine-probe.js';

const POWER_SUPPLY = '/sys/class/power_supply';

/**
 * True when the MACHINE's battery is discharging and no mains supply is online.
 *
 * A supply with `scope` `Device` is a peripheral (a wireless mouse or keyboard, a headset), not
 * the machine: a desktop with a mouse running down would otherwise count as on battery forever.
 */
export function onBattery(probe: MachineProbe = systemProbe(), root: string = POWER_SUPPLY): boolean {
    if (probe.platform === 'darwin') {
        return onBatteryMac(probe.run('/usr/bin/pmset', ['-g', 'batt'], 2000));
    }
    if (probe.platform !== 'linux') return false;
    const read = (name: string, file: string) => probe.read(join(root, name, file)) ?? '';
    let discharging = false;
    for (const name of probe.list(root)) {
        const type = read(name, 'type');
        if (type === 'Mains' && read(name, 'online') === '1') return false;
        if (type === 'Battery' && read(name, 'scope') === 'Device') continue;
        if (type === 'Battery' && read(name, 'status') === 'Discharging') discharging = true;
    }
    return discharging;
}

/** `pmset -g batt` prints which source the machine draws from: "Battery Power", "AC Power" or "UPS Power". */
export function onBatteryMac(pmsetOutput: string | undefined): boolean {
    return pmsetOutput !== undefined && /drawing from 'Battery Power'/.test(pmsetOutput);
}
