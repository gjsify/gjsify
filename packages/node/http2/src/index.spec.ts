// Ported from refs/node-test/parallel/test-http2-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import http2 from 'node:http2';

// @types/node is missing some http2 constants that Node.js exports at runtime.
declare module 'node:http2' {
  namespace constants {
    const NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL: number;
    const DEFAULT_SETTINGS_MAX_HEADER_LIST_SIZE: number;
    const HTTP2_HEADER_PROTOCOL: string;
  }
}

const {
  constants,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  sensitiveHeaders,
  createServer,
  createSecureServer,
  connect,
  Http2ServerRequest,
  Http2ServerResponse,
} = http2;

export default async () => {
  // --- Constants ---

  await describe('http2.constants', async () => {
    await it('should export constants object', async () => {
      expect(constants).toBeDefined();
      expect(typeof constants).toBe('object');
    });

    await it('should have NGHTTP2 error codes', async () => {
      expect(constants.NGHTTP2_NO_ERROR).toBe(0x00);
      expect(constants.NGHTTP2_PROTOCOL_ERROR).toBe(0x01);
      expect(constants.NGHTTP2_INTERNAL_ERROR).toBe(0x02);
      expect(constants.NGHTTP2_FLOW_CONTROL_ERROR).toBe(0x03);
      expect(constants.NGHTTP2_SETTINGS_TIMEOUT).toBe(0x04);
      expect(constants.NGHTTP2_STREAM_CLOSED).toBe(0x05);
      expect(constants.NGHTTP2_FRAME_SIZE_ERROR).toBe(0x06);
      expect(constants.NGHTTP2_REFUSED_STREAM).toBe(0x07);
      expect(constants.NGHTTP2_CANCEL).toBe(0x08);
      expect(constants.NGHTTP2_COMPRESSION_ERROR).toBe(0x09);
      expect(constants.NGHTTP2_CONNECT_ERROR).toBe(0x0a);
      expect(constants.NGHTTP2_ENHANCE_YOUR_CALM).toBe(0x0b);
      expect(constants.NGHTTP2_INADEQUATE_SECURITY).toBe(0x0c);
      expect(constants.NGHTTP2_HTTP_1_1_REQUIRED).toBe(0x0d);
    });

    await it('should have session type constants', async () => {
      expect(constants.NGHTTP2_SESSION_SERVER).toBe(0);
      expect(constants.NGHTTP2_SESSION_CLIENT).toBe(1);
    });

    await it('should have stream state constants', async () => {
      expect(constants.NGHTTP2_STREAM_STATE_IDLE).toBe(1);
      expect(constants.NGHTTP2_STREAM_STATE_OPEN).toBe(2);
      expect(constants.NGHTTP2_STREAM_STATE_RESERVED_LOCAL).toBe(3);
      expect(constants.NGHTTP2_STREAM_STATE_RESERVED_REMOTE).toBe(4);
      expect(constants.NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL).toBe(5);
      expect(constants.NGHTTP2_STREAM_STATE_HALF_CLOSED_REMOTE).toBe(6);
      expect(constants.NGHTTP2_STREAM_STATE_CLOSED).toBe(7);
    });

    await it('should have settings ID constants', async () => {
      expect(constants.NGHTTP2_SETTINGS_HEADER_TABLE_SIZE).toBe(0x01);
      expect(constants.NGHTTP2_SETTINGS_ENABLE_PUSH).toBe(0x02);
      expect(constants.NGHTTP2_SETTINGS_MAX_CONCURRENT_STREAMS).toBe(0x03);
      expect(constants.NGHTTP2_SETTINGS_INITIAL_WINDOW_SIZE).toBe(0x04);
      expect(constants.NGHTTP2_SETTINGS_MAX_FRAME_SIZE).toBe(0x05);
      expect(constants.NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE).toBe(0x06);
      expect(constants.NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL).toBe(0x08);
    });

    await it('should have default settings value constants', async () => {
      expect(constants.DEFAULT_SETTINGS_HEADER_TABLE_SIZE).toBe(4096);
      expect(constants.DEFAULT_SETTINGS_ENABLE_PUSH).toBe(1);
      expect(constants.DEFAULT_SETTINGS_INITIAL_WINDOW_SIZE).toBe(65535);
      expect(constants.DEFAULT_SETTINGS_MAX_FRAME_SIZE).toBe(16384);
      expect(constants.DEFAULT_SETTINGS_MAX_HEADER_LIST_SIZE).toBe(65535);
    });

    await it('should have frame flag constants', async () => {
      expect(constants.NGHTTP2_FLAG_NONE).toBe(0);
      expect(constants.NGHTTP2_FLAG_END_STREAM).toBe(0x01);
      expect(constants.NGHTTP2_FLAG_END_HEADERS).toBe(0x04);
      expect(constants.NGHTTP2_FLAG_PADDED).toBe(0x08);
      expect(constants.NGHTTP2_FLAG_PRIORITY).toBe(0x20);
    });

    await it('should have HTTP/2 pseudo-header constants', async () => {
      expect(constants.HTTP2_HEADER_STATUS).toBe(':status');
      expect(constants.HTTP2_HEADER_METHOD).toBe(':method');
      expect(constants.HTTP2_HEADER_PATH).toBe(':path');
      expect(constants.HTTP2_HEADER_AUTHORITY).toBe(':authority');
      expect(constants.HTTP2_HEADER_SCHEME).toBe(':scheme');
      expect(constants.HTTP2_HEADER_PROTOCOL).toBe(':protocol');
    });

    await it('should have standard HTTP header constants', async () => {
      expect(constants.HTTP2_HEADER_CONTENT_TYPE).toBe('content-type');
      expect(constants.HTTP2_HEADER_CONTENT_LENGTH).toBe('content-length');
      expect(constants.HTTP2_HEADER_ACCEPT).toBe('accept');
      expect(constants.HTTP2_HEADER_AUTHORIZATION).toBe('authorization');
      expect(constants.HTTP2_HEADER_CACHE_CONTROL).toBe('cache-control');
      expect(constants.HTTP2_HEADER_COOKIE).toBe('cookie');
      expect(constants.HTTP2_HEADER_SET_COOKIE).toBe('set-cookie');
      expect(constants.HTTP2_HEADER_USER_AGENT).toBe('user-agent');
      expect(constants.HTTP2_HEADER_HOST).toBe('host');
    });

    await it('should have HTTP method constants', async () => {
      expect(constants.HTTP2_METHOD_GET).toBe('GET');
      expect(constants.HTTP2_METHOD_POST).toBe('POST');
      expect(constants.HTTP2_METHOD_PUT).toBe('PUT');
      expect(constants.HTTP2_METHOD_DELETE).toBe('DELETE');
      expect(constants.HTTP2_METHOD_PATCH).toBe('PATCH');
      expect(constants.HTTP2_METHOD_HEAD).toBe('HEAD');
      expect(constants.HTTP2_METHOD_OPTIONS).toBe('OPTIONS');
      expect(constants.HTTP2_METHOD_CONNECT).toBe('CONNECT');
    });

    await it('should have HTTP status code constants', async () => {
      expect(constants.HTTP_STATUS_CONTINUE).toBe(100);
      expect(constants.HTTP_STATUS_OK).toBe(200);
      expect(constants.HTTP_STATUS_CREATED).toBe(201);
      expect(constants.HTTP_STATUS_NO_CONTENT).toBe(204);
      expect(constants.HTTP_STATUS_MOVED_PERMANENTLY).toBe(301);
      expect(constants.HTTP_STATUS_NOT_FOUND).toBe(404);
      expect(constants.HTTP_STATUS_TEAPOT).toBe(418);
      expect(constants.HTTP_STATUS_INTERNAL_SERVER_ERROR).toBe(500);
      expect(constants.HTTP_STATUS_BAD_GATEWAY).toBe(502);
      expect(constants.HTTP_STATUS_SERVICE_UNAVAILABLE).toBe(503);
    });

    await it('should have frame size constraint constants', async () => {
      expect(constants.MAX_MAX_FRAME_SIZE).toBe(16777215);
      expect(constants.MIN_MAX_FRAME_SIZE).toBe(16384);
      expect(constants.MAX_INITIAL_WINDOW_SIZE).toBe(2147483647);
      expect(constants.NGHTTP2_DEFAULT_WEIGHT).toBe(16);
    });
  });

  // --- Settings ---

  await describe('http2.getDefaultSettings', async () => {
    await it('should return an object with default settings', async () => {
      const settings = getDefaultSettings();
      expect(settings).toBeDefined();
      expect(typeof settings).toBe('object');
    });

    await it('should have headerTableSize = 4096', async () => {
      expect(getDefaultSettings().headerTableSize).toBe(4096);
    });

    await it('should have enablePush = true', async () => {
      expect(getDefaultSettings().enablePush).toBe(true);
    });

    await it('should have initialWindowSize = 65535', async () => {
      expect(getDefaultSettings().initialWindowSize).toBe(65535);
    });

    await it('should have maxFrameSize = 16384', async () => {
      expect(getDefaultSettings().maxFrameSize).toBe(16384);
    });

    await it('should have enableConnectProtocol = false', async () => {
      expect(getDefaultSettings().enableConnectProtocol).toBe(false);
    });
  });

  await describe('http2.getPackedSettings / getUnpackedSettings', async () => {
    await it('getPackedSettings should return Uint8Array', async () => {
      const packed = getPackedSettings({ headerTableSize: 4096 });
      expect(packed instanceof Uint8Array).toBe(true);
    });

    await it('getPackedSettings with no args should return empty', async () => {
      // Calling getPackedSettings() without args is valid at runtime; @types/node requires one arg.
      const packed = (getPackedSettings as any)();
      expect(packed.byteLength).toBe(0);
    });

    await it('getPackedSettings should encode one setting as 6 bytes', async () => {
      const packed = getPackedSettings({ headerTableSize: 4096 });
      expect(packed.byteLength).toBe(6);
    });

    await it('getPackedSettings should encode multiple settings', async () => {
      const packed = getPackedSettings({
        headerTableSize: 4096,
        enablePush: true,
        maxFrameSize: 32768,
      });
      expect(packed.byteLength).toBe(18);
    });

    await it('round-trip should preserve settings', async () => {
      const original = {
        headerTableSize: 8192,
        enablePush: false,
        maxConcurrentStreams: 100,
        initialWindowSize: 32768,
        maxFrameSize: 32768,
      };
      const packed = getPackedSettings(original);
      const unpacked = getUnpackedSettings(packed);
      expect(unpacked.headerTableSize).toBe(8192);
      expect(unpacked.enablePush).toBe(false);
      expect(unpacked.maxConcurrentStreams).toBe(100);
      expect(unpacked.initialWindowSize).toBe(32768);
      expect(unpacked.maxFrameSize).toBe(32768);
    });

    await it('getUnpackedSettings should throw on invalid length', async () => {
      let threw = false;
      try {
        getUnpackedSettings(new Uint8Array(7));
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  // --- sensitiveHeaders ---

  await describe('http2.sensitiveHeaders', async () => {
    await it('should be a symbol', async () => {
      expect(typeof sensitiveHeaders).toBe('symbol');
    });
  });

  // --- Factory functions ---

  await describe('http2 factory functions', async () => {
    await it('createServer should be a function', async () => {
      expect(typeof createServer).toBe('function');
    });

    await it('createSecureServer should be a function', async () => {
      expect(typeof createSecureServer).toBe('function');
    });

    await it('connect should be a function', async () => {
      expect(typeof connect).toBe('function');
    });

    // Note: createServer/createSecureServer/connect work on Node.js but throw on GJS.
    // Testing the throw behavior would be platform-specific.
  });

  // --- Class exports ---

  await describe('http2 class exports', async () => {
    await it('should export Http2ServerRequest', async () => {
      expect(typeof Http2ServerRequest).toBe('function');
    });

    await it('should export Http2ServerResponse', async () => {
      expect(typeof Http2ServerResponse).toBe('function');
    });

    // Note: Http2Session, Http2Stream, ServerHttp2Session are exported differently
    // on Node.js (named exports) vs our implementation (default export).
    // Testing export availability would be platform-specific.
  });
};
