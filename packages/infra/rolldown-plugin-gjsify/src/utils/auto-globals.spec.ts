import { describe, it, expect } from '@gjsify/unit';
import { giNamespacesForRegister } from './auto-globals.js';

describe('giNamespacesForRegister', () => {
    it('matches a register path', () => {
        const result = giNamespacesForRegister('pkg/register/foo');
        expect(result).not.toBeNull();
    });

    it('does not match a non-register path', () => {
        const result = giNamespacesForRegister('pkg/other');
        expect(result).toBeNull();
    });

    it('matches the register path itself', () => {
        const result = giNamespacesForRegister('pkg/register');
        expect(result).not.toBeNull();
    });
});
