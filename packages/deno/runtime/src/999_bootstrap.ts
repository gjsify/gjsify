import * as build from './01_build.js';
import * as errors from './01_errors.js';
import * as version from './01_version.js';
import * as webUtil from './01_web_util.js';
import * as util from './06_util.js';
import * as webidl from './ext/webidl/00_webidl.js';

window.__bootstrap ??= {};

window.__bootstrap.build = build;
  
window.__bootstrap.errors = {
    errors,
};

window.__bootstrap.version = version;
  
window.__bootstrap.webUtil = webUtil;

window.__bootstrap.internals = {
    ...window.__bootstrap.internals ?? {},
    pathFromURL: util.pathFromURL,
};

window.__bootstrap.webidl = webidl;

window.__bootstrap.url = {
    URL,
    URLPrototype,
    URLSearchParams,
    URLSearchParamsPrototype,
    parseUrlEncoded,
  };
  
  window.__bootstrap.urlPattern = {
    URLPattern,
  };

window.__bootstrap.util = util;

window.__bootstrap.fsEvents = {
    watchFs,
};

