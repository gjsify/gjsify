// Tests for W3C Web Storage API
// Reference: refs/deno/ext/webstorage/01_webstorage.js, refs/wpt/webstorage/

import { describe, it, expect } from '@gjsify/unit';
import { Storage, localStorage, sessionStorage } from 'webstorage';

export default async () => {

  // ==================== Storage class ====================

  await describe('Storage', async () => {
    await it('should be a constructor', async () => {
      expect(typeof Storage).toBe('function');
    });

    await it('should start with length 0', async () => {
      const s = new Storage();
      expect(s.length).toBe(0);
    });

    await it('should set and get items', async () => {
      const s = new Storage();
      s.setItem('key1', 'value1');
      expect(s.getItem('key1')).toBe('value1');
      expect(s.length).toBe(1);
    });

    await it('should return null for non-existent keys', async () => {
      const s = new Storage();
      expect(s.getItem('nonexistent')).toBeNull();
    });

    await it('should overwrite existing values', async () => {
      const s = new Storage();
      s.setItem('key', 'first');
      s.setItem('key', 'second');
      expect(s.getItem('key')).toBe('second');
      expect(s.length).toBe(1);
    });

    await it('should convert values to strings', async () => {
      const s = new Storage();
      s.setItem('num', 42 as any);
      expect(s.getItem('num')).toBe('42');
      s.setItem('bool', true as any);
      expect(s.getItem('bool')).toBe('true');
      s.setItem('null', null as any);
      expect(s.getItem('null')).toBe('null');
    });

    await it('should remove items', async () => {
      const s = new Storage();
      s.setItem('a', '1');
      s.setItem('b', '2');
      s.removeItem('a');
      expect(s.getItem('a')).toBeNull();
      expect(s.length).toBe(1);
    });

    await it('should handle removeItem for non-existent key', async () => {
      const s = new Storage();
      s.removeItem('doesnotexist');
      expect(s.length).toBe(0);
    });

    await it('should clear all items', async () => {
      const s = new Storage();
      s.setItem('x', '1');
      s.setItem('y', '2');
      s.setItem('z', '3');
      s.clear();
      expect(s.length).toBe(0);
      expect(s.getItem('x')).toBeNull();
    });

    await it('should return key by index', async () => {
      const s = new Storage();
      s.setItem('alpha', 'a');
      s.setItem('beta', 'b');
      const key0 = s.key(0);
      const key1 = s.key(1);
      expect(key0).toBeDefined();
      expect(key1).toBeDefined();
      // Keys should be one of the set keys
      expect(key0 === 'alpha' || key0 === 'beta').toBe(true);
    });

    await it('should return null for out-of-range key index', async () => {
      const s = new Storage();
      s.setItem('only', 'one');
      expect(s.key(-1)).toBeNull();
      expect(s.key(1)).toBeNull();
      expect(s.key(100)).toBeNull();
    });

    await it('should handle empty string keys and values', async () => {
      const s = new Storage();
      s.setItem('', 'empty-key');
      expect(s.getItem('')).toBe('empty-key');
      s.setItem('empty-val', '');
      expect(s.getItem('empty-val')).toBe('');
    });

    await it('should handle Unicode keys and values', async () => {
      const s = new Storage();
      s.setItem('emoji', '\u{1F600}');
      expect(s.getItem('emoji')).toBe('\u{1F600}');
      s.setItem('\u{1F4BB}', 'computer');
      expect(s.getItem('\u{1F4BB}')).toBe('computer');
    });
  });

  // ==================== localStorage ====================

  await describe('localStorage', async () => {
    // Clear before tests
    localStorage.clear();

    await it('should be an instance of Storage', async () => {
      expect(localStorage).toBeDefined();
      expect(typeof localStorage.getItem).toBe('function');
      expect(typeof localStorage.setItem).toBe('function');
      expect(typeof localStorage.removeItem).toBe('function');
      expect(typeof localStorage.clear).toBe('function');
      expect(typeof localStorage.key).toBe('function');
    });

    await it('should start empty (after clear)', async () => {
      expect(localStorage.length).toBe(0);
    });

    await it('should persist items within the same session', async () => {
      localStorage.setItem('test-key', 'test-value');
      expect(localStorage.getItem('test-key')).toBe('test-value');
      expect(localStorage.length).toBe(1);
    });

    await it('should support clear', async () => {
      localStorage.setItem('a', '1');
      localStorage.clear();
      expect(localStorage.length).toBe(0);
    });
  });

  // ==================== sessionStorage ====================

  await describe('sessionStorage', async () => {
    sessionStorage.clear();

    await it('should be an instance of Storage', async () => {
      expect(sessionStorage).toBeDefined();
      expect(typeof sessionStorage.getItem).toBe('function');
      expect(typeof sessionStorage.setItem).toBe('function');
    });

    await it('should store and retrieve data', async () => {
      sessionStorage.setItem('session-key', 'session-value');
      expect(sessionStorage.getItem('session-key')).toBe('session-value');
    });

    await it('should be independent from localStorage', async () => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('shared', 'from-local');
      sessionStorage.setItem('shared', 'from-session');
      expect(localStorage.getItem('shared')).toBe('from-local');
      expect(sessionStorage.getItem('shared')).toBe('from-session');
      localStorage.clear();
      sessionStorage.clear();
    });
  });
};
