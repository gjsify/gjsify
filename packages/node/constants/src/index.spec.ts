// constants module tests
// Reference: Node.js lib/constants.js — deprecated, merges os/fs/crypto constants

import { describe, it, expect } from '@gjsify/unit';
import constants from 'node:constants';

export default async () => {
  await describe('constants', async () => {
    await it('should export an object', async () => {
      expect(typeof constants).toBe('object');
      expect(constants).toBeDefined();
    });

    await it('should contain errno constants from os', async () => {
      expect(typeof constants.ENOENT).toBe('number');
      expect(typeof constants.EACCES).toBe('number');
      expect(typeof constants.EEXIST).toBe('number');
      expect(typeof constants.EPERM).toBe('number');
      expect(typeof constants.ECONNREFUSED).toBe('number');
    });

    await it('should contain signal constants from os', async () => {
      expect(typeof constants.SIGINT).toBe('number');
      expect(typeof constants.SIGTERM).toBe('number');
      expect(typeof constants.SIGHUP).toBe('number');
      expect(typeof constants.SIGKILL).toBe('number');
    });

    await it('should contain fs constants', async () => {
      expect(typeof constants.O_RDONLY).toBe('number');
      expect(typeof constants.O_WRONLY).toBe('number');
      expect(typeof constants.O_RDWR).toBe('number');
      expect(typeof constants.S_IFMT).toBe('number');
      expect(typeof constants.S_IFDIR).toBe('number');
      expect(typeof constants.S_IFREG).toBe('number');
    });

    await it('should contain crypto constants', async () => {
      expect(typeof constants.RSA_PKCS1_PADDING).toBe('number');
      expect(typeof constants.RSA_PKCS1_OAEP_PADDING).toBe('number');
    });

    await it('should contain priority constants from os', async () => {
      expect(typeof constants.PRIORITY_LOW).toBe('number');
      expect(typeof constants.PRIORITY_NORMAL).toBe('number');
      expect(typeof constants.PRIORITY_HIGH).toBe('number');
    });

    await it('should have correct errno values', async () => {
      // ENOENT is typically 2 on Linux
      expect(constants.ENOENT).toBeGreaterThan(0);
      expect(constants.EACCES).toBeGreaterThan(0);
    });

    await it('should have correct fs mode constants', async () => {
      expect(constants.O_RDONLY).toBe(0);
      expect(constants.O_WRONLY).toBe(1);
      expect(constants.O_RDWR).toBe(2);
    });
  });
};
