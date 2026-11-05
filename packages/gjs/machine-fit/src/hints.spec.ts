import { describe, it, expect } from '@gjsify/unit';

import { fakeMachine } from './fake-machine.js';
import { hasVulkan, onBattery, onBatteryMac, parseGpuSetting } from './index.js';

const LOADER = { '/usr/lib64/libvulkan.so.1': '' };
const PS = '/sys/class/power_supply';

export default async () => {
    await describe('hasVulkan', async () => {
        await it('needs the loader AND a driver manifest', async () => {
            expect(hasVulkan(fakeMachine({ files: LOADER }))).toBe(false);
            expect(hasVulkan(fakeMachine({ files: { '/usr/share/vulkan/icd.d/radeon_icd.json': '{}' } }))).toBe(false);
            expect(
                hasVulkan(fakeMachine({ files: { ...LOADER, '/usr/share/vulkan/icd.d/radeon_icd.json': '{}' } })),
            ).toBe(true);
        });
        await it('finds the loader on LD_LIBRARY_PATH and a driver named by the loader overrides', async () => {
            const machine = fakeMachine({
                env: { LD_LIBRARY_PATH: '/opt/sdk/lib', VK_DRIVER_FILES: '/opt/icd/nvidia.json' },
                files: { '/opt/sdk/lib/libvulkan.so.1': '' },
            });
            expect(hasVulkan(machine)).toBe(true);
        });
        await it('finds a driver in the Flatpak GL extension', async () => {
            const machine = fakeMachine({
                files: { ...LOADER, '/usr/lib/x86_64-linux-gnu/GL/vulkan/icd.d/intel_icd.x86_64.json': '{}' },
            });
            expect(hasVulkan(machine)).toBe(true);
        });
        await it('says no off Linux', async () => {
            const files = { ...LOADER, '/usr/share/vulkan/icd.d/radeon_icd.json': '{}' };
            expect(hasVulkan(fakeMachine({ platform: 'darwin', files }))).toBe(false);
        });
    });

    await describe('parseGpuSetting', async () => {
        await it('reads off, on and everything else as auto', async () => {
            expect(parseGpuSetting(' CPU ')).toBe('off');
            expect(parseGpuSetting('0')).toBe('off');
            expect(parseGpuSetting('yes')).toBe('on');
            expect(parseGpuSetting('')).toBe('auto');
            expect(parseGpuSetting(undefined)).toBe('auto');
            expect(parseGpuSetting('vulkan')).toBe('auto');
        });
    });

    await describe('onBattery', async () => {
        await it('is true when the battery discharges and no mains is online', async () => {
            const machine = fakeMachine({
                files: {
                    [`${PS}/AC/type`]: 'Mains',
                    [`${PS}/AC/online`]: '0',
                    [`${PS}/BAT0/type`]: 'Battery',
                    [`${PS}/BAT0/status`]: 'Discharging',
                },
            });
            expect(onBattery(machine)).toBe(true);
        });
        await it('is false on mains even while a battery reports discharging', async () => {
            const machine = fakeMachine({
                files: {
                    [`${PS}/AC/type`]: 'Mains',
                    [`${PS}/AC/online`]: '1',
                    [`${PS}/BAT0/type`]: 'Battery',
                    [`${PS}/BAT0/status`]: 'Discharging',
                },
            });
            expect(onBattery(machine)).toBe(false);
        });
        await it("ignores a peripheral's battery", async () => {
            const machine = fakeMachine({
                files: {
                    [`${PS}/hidpp_battery_0/type`]: 'Battery',
                    [`${PS}/hidpp_battery_0/scope`]: 'Device',
                    [`${PS}/hidpp_battery_0/status`]: 'Discharging',
                },
            });
            expect(onBattery(machine)).toBe(false);
        });
        await it('is false where there is no power supply class at all', async () => {
            expect(onBattery(fakeMachine())).toBe(false);
            expect(onBattery(fakeMachine({ platform: 'win32' }))).toBe(false);
        });
        await it('asks pmset on macOS', async () => {
            const battery = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t80%; discharging";
            const machine = fakeMachine({ platform: 'darwin', commands: { '/usr/bin/pmset -g batt': battery } });
            expect(onBattery(machine)).toBe(true);
            expect(onBatteryMac("Now drawing from 'AC Power'")).toBe(false);
            expect(onBatteryMac(undefined)).toBe(false);
        });
    });
};
