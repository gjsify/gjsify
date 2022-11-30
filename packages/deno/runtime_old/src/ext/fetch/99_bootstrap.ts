import * as fetchUtil from './01_fetch_util.js';
import * as headers from './20_headers.js';
import * as formData from './21_formdata.js';
import * as fetchBody from './22_body.js';
import * as fetchHttpClient from './22_http_client.js';
import * as fetchRequest from './23_request.js';
import * as fetchResponse from './23_response.js';
import * as _fetch from './26_fetch.js';

const fetch = {
    // packages/deno/runtime/src/ext/fetch/23_response.ts
    ...fetchResponse,
    // packages/deno/runtime/src/ext/fetch/22_http_client.ts
    ...fetchHttpClient,

    // packages/deno/runtime/src/ext/fetch/23_request.ts
    ...fetchRequest,

    // packages/deno/runtime/src/ext/fetch/26_fetch.ts
    ..._fetch,
};

export { fetchUtil, headers, formData, fetchBody, fetch}