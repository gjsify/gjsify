
// packages/deno/runtime/src/ext/fetch/01_fetch_util.ts
window.__bootstrap.fetchUtil = {
    requiredArguments,
};

// packages/deno/runtime/src/ext/fetch/20_headers.ts
window.__bootstrap.headers = {
    headersFromHeaderList,
    headerListFromHeaders,
    getDecodeSplitHeader,
    guardFromHeaders,
    fillHeaders,
    getHeader,
    Headers,
};

// packages/deno/runtime/src/ext/fetch/21_formdata.ts
globalThis.__bootstrap.formData = {
    FormData,
    FormDataPrototype,
    formDataToBlob,
    parseFormData,
    formDataFromEntries,
};

// packages/deno/runtime/src/ext/fetch/22_body.ts
window.__bootstrap.fetchBody = { mixinBody, InnerBody, extractBody };

// packages/deno/runtime/src/ext/fetch/22_http_client.ts
window.__bootstrap.fetch ??= {};
window.__bootstrap.fetch.createHttpClient = createHttpClient;
window.__bootstrap.fetch.HttpClient = HttpClient;
window.__bootstrap.fetch.HttpClientPrototype = HttpClientPrototype;
