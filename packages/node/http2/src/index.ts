export function createServer(_options?: any): any {
  throw new Error('http2.createServer() is not yet implemented in GJS');
}

export function createSecureServer(_options?: any): any {
  throw new Error('http2.createSecureServer() is not yet implemented in GJS');
}

export function connect(_authority: string, _options?: any): any {
  throw new Error('http2.connect() is not yet implemented in GJS');
}

export const constants = {
  NGHTTP2_ERR_FRAME_SIZE_ERROR: -522,
  NGHTTP2_SESSION_SERVER: 0,
  NGHTTP2_SESSION_CLIENT: 1,
  NGHTTP2_STREAM_STATE_IDLE: 1,
  NGHTTP2_STREAM_STATE_OPEN: 2,
  NGHTTP2_HCAT_REQUEST: 0,
  NGHTTP2_HCAT_RESPONSE: 1,
  NGHTTP2_NV_FLAG_NONE: 0,
  NGHTTP2_NV_FLAG_NO_INDEX: 1,
  HTTP2_HEADER_STATUS: ':status',
  HTTP2_HEADER_METHOD: ':method',
  HTTP2_HEADER_PATH: ':path',
  HTTP2_HEADER_AUTHORITY: ':authority',
  HTTP2_HEADER_SCHEME: ':scheme',
  HTTP2_HEADER_CONTENT_TYPE: 'content-type',
  HTTP2_HEADER_CONTENT_LENGTH: 'content-length',
  HTTP_STATUS_OK: 200,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
};

export function getDefaultSettings(): any {
  return {};
}

export function getPackedSettings(_settings?: any): Buffer {
  return Buffer.alloc(0);
}

export function getUnpackedSettings(_buf: Buffer): any {
  return {};
}

export const sensitiveHeaders = Symbol('http2.sensitiveHeaders');

export default {
  createServer,
  createSecureServer,
  connect,
  constants,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  sensitiveHeaders,
};
