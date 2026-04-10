// Gamepad Web API — tests
// Ported tests verify class construction, mapping tables, and event dispatch.

import { describe, it, expect } from '@gjsify/unit';
import { GamepadButton } from './gamepad-button.js';
import { Gamepad } from './gamepad.js';
import { GamepadEvent } from './gamepad-event.js';
import { MANETTE_TO_W3C_BUTTON, W3CButton, ManetteButton, W3C_BUTTON_COUNT } from './button-mapping.js';
import { MANETTE_TO_W3C_AXIS, W3CAxis, ManetteAxis, W3C_AXIS_COUNT } from './axis-mapping.js';
import { GamepadManager } from './gamepad-manager.js';

export default async () => {
    await describe('GamepadButton', async () => {
        await it('should construct with default values', async () => {
            const btn = new GamepadButton();
            expect(btn.pressed).toBe(false);
            expect(btn.touched).toBe(false);
            expect(btn.value).toBe(0);
        });

        await it('should construct with specified values', async () => {
            const btn = new GamepadButton(true, true, 0.75);
            expect(btn.pressed).toBe(true);
            expect(btn.touched).toBe(true);
            expect(btn.value).toBe(0.75);
        });

        await it('should have correct Symbol.toStringTag', async () => {
            const btn = new GamepadButton();
            expect(Object.prototype.toString.call(btn)).toBe('[object GamepadButton]');
        });
    });

    await describe('Gamepad', async () => {
        await it('should construct with all properties', async () => {
            const buttons = Array.from({ length: W3C_BUTTON_COUNT }, () => new GamepadButton());
            const axes = [0, 0, 0, 0];
            const gp = new Gamepad({
                id: 'Test Controller',
                index: 0,
                connected: true,
                timestamp: 123.456,
                mapping: 'standard',
                axes,
                buttons,
            });

            expect(gp.id).toBe('Test Controller');
            expect(gp.index).toBe(0);
            expect(gp.connected).toBe(true);
            expect(gp.timestamp).toBe(123.456);
            expect(gp.mapping).toBe('standard');
            expect(gp.axes.length).toBe(4);
            expect(gp.buttons.length).toBe(W3C_BUTTON_COUNT);
            expect(gp.vibrationActuator).toBeNull();
        });

        await it('should freeze axes and buttons arrays', async () => {
            const buttons = Array.from({ length: W3C_BUTTON_COUNT }, () => new GamepadButton());
            const gp = new Gamepad({
                id: 'Test',
                index: 0,
                connected: true,
                timestamp: 0,
                mapping: 'standard',
                axes: [0, 0, 0, 0],
                buttons,
            });

            expect(Object.isFrozen(gp.axes)).toBe(true);
            expect(Object.isFrozen(gp.buttons)).toBe(true);
        });
    });

    await describe('GamepadEvent', async () => {
        await it('should construct with gamepad', async () => {
            const buttons = Array.from({ length: W3C_BUTTON_COUNT }, () => new GamepadButton());
            const gp = new Gamepad({
                id: 'Test',
                index: 0,
                connected: true,
                timestamp: 0,
                mapping: 'standard',
                axes: [0, 0, 0, 0],
                buttons,
            });

            const event = new GamepadEvent('gamepadconnected', { gamepad: gp });
            expect(event.type).toBe('gamepadconnected');
            expect(event.gamepad).toBe(gp);
        });

        await it('should have correct Symbol.toStringTag', async () => {
            const buttons = Array.from({ length: W3C_BUTTON_COUNT }, () => new GamepadButton());
            const gp = new Gamepad({
                id: 'Test',
                index: 0,
                connected: true,
                timestamp: 0,
                mapping: 'standard',
                axes: [0, 0, 0, 0],
                buttons,
            });

            const event = new GamepadEvent('gamepadconnected', { gamepad: gp });
            expect(Object.prototype.toString.call(event)).toBe('[object GamepadEvent]');
        });
    });

    await describe('Button Mapping', async () => {
        await it('should map 17 buttons (including triggers)', async () => {
            expect(MANETTE_TO_W3C_BUTTON.size).toBe(17);
        });

        await it('should map face buttons (Linux BTN_* codes)', async () => {
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_SOUTH)).toBe(W3CButton.FACE_1);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_EAST)).toBe(W3CButton.FACE_2);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_WEST)).toBe(W3CButton.FACE_3);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_NORTH)).toBe(W3CButton.FACE_4);
        });

        await it('should map d-pad buttons correctly', async () => {
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_DPAD_UP)).toBe(W3CButton.DPAD_UP);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_DPAD_DOWN)).toBe(W3CButton.DPAD_DOWN);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_DPAD_LEFT)).toBe(W3CButton.DPAD_LEFT);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_DPAD_RIGHT)).toBe(W3CButton.DPAD_RIGHT);
        });

        await it('should map shoulder, trigger and stick buttons correctly', async () => {
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_TL)).toBe(W3CButton.LEFT_BUMPER);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_TR)).toBe(W3CButton.RIGHT_BUMPER);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_TL2)).toBe(W3CButton.LEFT_TRIGGER);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_TR2)).toBe(W3CButton.RIGHT_TRIGGER);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_THUMBL)).toBe(W3CButton.LEFT_STICK);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_THUMBR)).toBe(W3CButton.RIGHT_STICK);
        });

        await it('should map meta buttons correctly', async () => {
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_SELECT)).toBe(W3CButton.SELECT);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_START)).toBe(W3CButton.START);
            expect(MANETTE_TO_W3C_BUTTON.get(ManetteButton.BTN_MODE)).toBe(W3CButton.HOME);
        });

        await it('should produce unique W3C indices', async () => {
            const w3cIndices = new Set(MANETTE_TO_W3C_BUTTON.values());
            expect(w3cIndices.size).toBe(MANETTE_TO_W3C_BUTTON.size);
        });
    });

    await describe('Axis Mapping', async () => {
        await it('should map 4 stick axes', async () => {
            expect(MANETTE_TO_W3C_AXIS.size).toBe(4);
        });

        await it('should map stick axes correctly (Linux ABS_* codes)', async () => {
            expect(MANETTE_TO_W3C_AXIS.get(ManetteAxis.ABS_X)).toBe(W3CAxis.LEFT_STICK_X);
            expect(MANETTE_TO_W3C_AXIS.get(ManetteAxis.ABS_Y)).toBe(W3CAxis.LEFT_STICK_Y);
            expect(MANETTE_TO_W3C_AXIS.get(ManetteAxis.ABS_RX)).toBe(W3CAxis.RIGHT_STICK_X);
            expect(MANETTE_TO_W3C_AXIS.get(ManetteAxis.ABS_RY)).toBe(W3CAxis.RIGHT_STICK_Y);
        });

        await it('should NOT map trigger axes (they go to buttons)', async () => {
            expect(MANETTE_TO_W3C_AXIS.get(ManetteAxis.ABS_Z)).toBeUndefined();
            expect(MANETTE_TO_W3C_AXIS.get(ManetteAxis.ABS_RZ)).toBeUndefined();
        });
    });

    await describe('GamepadManager', async () => {
        await it('should return an array of 4 slots from getGamepads()', async () => {
            const manager = new GamepadManager();
            const pads = manager.getGamepads();
            expect(pads.length).toBe(4);
        });

        await it('should return null for all slots when no device is connected', async () => {
            const manager = new GamepadManager();
            const pads = manager.getGamepads();
            for (const pad of pads) {
                expect(pad).toBeNull();
            }
        });

        await it('should be safe to call dispose()', async () => {
            const manager = new GamepadManager();
            manager.getGamepads();
            manager.dispose();
            // Should not throw
            expect(true).toBe(true);
        });
    });
};
