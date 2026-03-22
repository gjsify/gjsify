import { describe, it, expect } from '@gjsify/unit';
import { constants, getDefaultSettings, sensitiveHeaders } from 'http2';

export default async () => {
  await describe('http2', async () => {
    await it('should export constants', async () => {
      expect(constants).toBeDefined();
    });

    await it('should have HTTP status constants', async () => {
      expect(constants.HTTP_STATUS_OK).toBe(200);
      expect(constants.HTTP_STATUS_NOT_FOUND).toBe(404);
      expect(constants.HTTP_STATUS_INTERNAL_SERVER_ERROR).toBe(500);
    });

    await it('should have HTTP2 header constants', async () => {
      expect(constants.HTTP2_HEADER_STATUS).toBe(':status');
      expect(constants.HTTP2_HEADER_METHOD).toBe(':method');
      expect(constants.HTTP2_HEADER_PATH).toBe(':path');
    });

    await it('should export getDefaultSettings as a function', async () => {
      expect(typeof getDefaultSettings).toBe('function');
      const settings = getDefaultSettings();
      expect(settings).toBeDefined();
    });

    await it('should export sensitiveHeaders as a symbol', async () => {
      expect(typeof sensitiveHeaders).toBe('symbol');
    });
  });
};
