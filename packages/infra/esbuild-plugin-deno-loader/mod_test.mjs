var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// deps.ts
import { pathToFileURL, fileURLToPath } from "url";
import { basename, extname, resolve } from "path";

// ../../../node_modules/deno-importmap/lib/mod.mjs
function isObject(object) {
  return typeof object == "object" && object !== null && object.constructor === Object;
}
function sortObject(normalized) {
  const sorted = {};
  const sortedKeys = Object.keys(normalized).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    sorted[key] = normalized[key];
  }
  return sorted;
}
function isImportMap(importMap) {
  return isObject(importMap) && (importMap.imports !== void 0 ? isImports(importMap.imports) : true) && (importMap.scopes !== void 0 ? isScopes(importMap.scopes) : true);
}
function isImports(importsMap) {
  return isObject(importsMap);
}
function isScopes(scopes) {
  return isObject(scopes) && Object.values(scopes).every((value) => isSpecifierMap(value));
}
function isSpecifierMap(specifierMap) {
  return isObject(specifierMap);
}
function isURL(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
function sortAndNormalizeSpecifierMap(originalMap, baseURL) {
  const normalized = {};
  for (const [specifierKey, value] of Object.entries(originalMap)) {
    const normalizedSpecifierKey = normalizeSpecifierKey(specifierKey, baseURL);
    if (normalizedSpecifierKey === null)
      continue;
    if (typeof value !== "string") {
      console.warn(`addresses need to be strings.`);
      normalized[normalizedSpecifierKey] = null;
      continue;
    }
    const addressURL = parseUrlLikeImportSpecifier(value, baseURL);
    if (addressURL === null) {
      console.warn(`the address was invalid.`);
      normalized[normalizedSpecifierKey] = null;
      continue;
    }
    if (specifierKey.endsWith("/") && !serializeURL(addressURL).endsWith("/")) {
      console.warn(
        `an invalid address was given for the specifier key specifierKey; since specifierKey ended in a slash, the address needs to as well.`
      );
      normalized[normalizedSpecifierKey] = null;
      continue;
    }
    normalized[normalizedSpecifierKey] = serializeURL(addressURL);
  }
  return sortObject(normalized);
}
function serializeURL(url) {
  return url.href;
}
function sortAndNormalizeScopes(originalMap, baseURL) {
  const normalized = {};
  for (const [scopePrefix, potentialSpecifierMap] of Object.entries(originalMap)) {
    if (!isSpecifierMap(potentialSpecifierMap)) {
      throw new TypeError(
        `the value of the scope with prefix scopePrefix needs to be an object.`
      );
    }
    let scopePrefixURL;
    try {
      scopePrefixURL = new URL(scopePrefix, baseURL);
    } catch {
      console.warn(`the scope prefix URL was not parseable.`);
      continue;
    }
    const normalizedScopePrefix = serializeURL(scopePrefixURL);
    normalized[normalizedScopePrefix] = sortAndNormalizeSpecifierMap(
      potentialSpecifierMap,
      baseURL
    );
  }
  const sorted = {};
  for (const key of Object.keys(normalized)) {
    sorted[key] = sortObject(normalized[key]);
  }
  return sortObject(sorted);
}
function normalizeSpecifierKey(specifierKey, baseURL) {
  if (!specifierKey.length) {
    console.warn("specifier key cannot be an empty string.");
    return null;
  }
  const url = parseUrlLikeImportSpecifier(specifierKey, baseURL);
  if (url !== null) {
    return serializeURL(url);
  }
  return specifierKey;
}
function parseUrlLikeImportSpecifier(specifier, baseURL) {
  if (baseURL && (specifier.startsWith("/") || specifier.startsWith("./") || specifier.startsWith("../"))) {
    try {
      const url = new URL(specifier, baseURL);
      return url;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(specifier);
    return url;
  } catch {
    return null;
  }
}
var specialSchemes = [
  "ftp",
  "file",
  "http",
  "https",
  "ws",
  "wss"
];
function isSpecial(asURL) {
  return specialSchemes.some(
    (scheme) => serializeURL(asURL).startsWith(scheme)
  );
}
function resolveImportsMatch(normalizedSpecifier, asURL, specifierMap) {
  for (const [specifierKey, resolutionResult] of Object.entries(specifierMap)) {
    if (specifierKey === normalizedSpecifier) {
      if (resolutionResult === null) {
        throw new TypeError(
          `resolution of specifierKey was blocked by a null entry.`
        );
      }
      if (!isURL(resolutionResult)) {
        throw new TypeError(`resolutionResult must be an URL.`);
      }
      return resolutionResult;
    } else if (specifierKey.endsWith("/") && normalizedSpecifier.startsWith(specifierKey) && (asURL === null || isSpecial(asURL))) {
      if (resolutionResult === null) {
        throw new TypeError(
          `resolution of specifierKey was blocked by a null entry.`
        );
      }
      if (!isURL(resolutionResult)) {
        throw new TypeError(`resolutionResult must be an URL.`);
      }
      const afterPrefix = normalizedSpecifier.slice(specifierKey.length);
      if (!resolutionResult.endsWith("/")) {
        throw new TypeError(`resolutionResult does not end with "/"`);
      }
      try {
        const url = new URL(afterPrefix, resolutionResult);
        if (!isURL(url)) {
          throw new TypeError(`url must be an URL.`);
        }
        if (!serializeURL(url).startsWith(resolutionResult)) {
          throw new TypeError(
            `resolution of normalizedSpecifier was blocked due to it backtracking above its prefix specifierKey.`
          );
        }
        return serializeURL(url);
      } catch {
        throw new TypeError(
          `resolution of normalizedSpecifier was blocked since the afterPrefix portion could not be URL-parsed relative to the resolutionResult mapped to by the specifierKey prefix.`
        );
      }
    }
  }
  return null;
}
function resolveImportMap(importMap, baseURL) {
  let sortedAndNormalizedImports = {};
  if (!isImportMap(importMap)) {
    throw new TypeError(`the top-level value needs to be a JSON object.`);
  }
  const { imports, scopes } = importMap;
  if (imports !== void 0) {
    if (!isImports(imports)) {
      throw new TypeError(`"imports" top-level key needs to be an object.`);
    }
    sortedAndNormalizedImports = sortAndNormalizeSpecifierMap(
      imports,
      baseURL
    );
  }
  let sortedAndNormalizedScopes = {};
  if (scopes !== void 0) {
    if (!isScopes(scopes)) {
      throw new TypeError(`"scopes" top-level key needs to be an object.`);
    }
    sortedAndNormalizedScopes = sortAndNormalizeScopes(
      scopes,
      baseURL
    );
  }
  if (Object.keys(importMap).find((key) => key !== "imports" && key !== "scopes")) {
    console.warn(`an invalid top-level key was present in the import map.`);
  }
  return {
    imports: sortedAndNormalizedImports,
    scopes: sortedAndNormalizedScopes
  };
}
function resolveModuleSpecifier(specifier, { imports = {}, scopes = {} }, baseURL) {
  const baseURLString = serializeURL(baseURL);
  const asURL = parseUrlLikeImportSpecifier(specifier, baseURL);
  const normalizedSpecifier = asURL !== null ? serializeURL(asURL) : specifier;
  for (const [scopePrefix, scopeImports] of Object.entries(scopes)) {
    if (scopePrefix === baseURLString || scopePrefix.endsWith("/") && baseURLString.startsWith(scopePrefix)) {
      const scopeImportsMatch = resolveImportsMatch(
        normalizedSpecifier,
        asURL,
        scopeImports
      );
      if (scopeImportsMatch !== null) {
        return scopeImportsMatch;
      }
    }
  }
  const topLevelImportsMatch = resolveImportsMatch(
    normalizedSpecifier,
    asURL,
    imports
  );
  if (topLevelImportsMatch !== null) {
    return topLevelImportsMatch;
  }
  if (asURL !== null) {
    return serializeURL(asURL);
  }
  throw new TypeError(
    `specifier was a bare specifier, but was not remapped to anything by importMap.`
  );
}

// deps.ts
var toFileUrl = pathToFileURL;
var fromFileUrl = fileURLToPath;

// src/deno.ts
import { tmpdir } from "os";

// src/run.ts
import { spawn } from "child_process";
var run = (cmd, args, options) => {
  return new Promise((resolve2, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, options);
    child.stdout.pipe(process.stdout);
    child.stdout.on("data", function(data) {
      this.emit("stdout", data);
      stdout += data.toString();
    });
    child.stderr.pipe(process.stderr);
    child.stderr.on("data", function(data) {
      this.emit("stderr", data);
      stderr += data.toString();
    });
    child.on("close", function(code, signal) {
      let result = {
        stdout: stdout.toString(),
        stderr: stderr.toString()
      };
      if (code === 0) {
        return resolve2(result);
      }
      const reason = {
        ...result,
        code
      };
      return reject(reason);
    });
  });
};

// src/deno.ts
var tempDir;
async function info(specifier, options) {
  const cmd = "deno";
  const args = [
    "info",
    "--json"
  ];
  if (options.importMap !== void 0) {
    args.push("--import-map", options.importMap);
  }
  args.push(specifier.href);
  if (!tempDir) {
    tempDir = tmpdir();
  }
  let proc;
  try {
    proc = await run(cmd, args, {
      cwd: tempDir
    });
    const txt = proc.stdout;
    return JSON.parse(txt);
  } catch (error) {
    throw new Error(`Failed to call '${cmd} ${args.join(" ")}' on '${specifier.href}'
${error.message}`);
  }
}

// src/shared.ts
function mediaTypeToLoader(mediaType) {
  switch (mediaType) {
    case "JavaScript":
    case "Mjs":
      return "js";
    case "JSX":
      return "jsx";
    case "TypeScript":
    case "Mts":
      return "ts";
    case "TSX":
      return "tsx";
    case "Json":
      return "js";
    default:
      throw new Error(`Unhandled media type ${mediaType}.`);
  }
}
function transformRawIntoContent(raw, mediaType) {
  switch (mediaType) {
    case "Json":
      return jsonToESM(raw);
    default:
      return raw;
  }
}
function jsonToESM(source) {
  const sourceString = new TextDecoder().decode(source);
  let json = JSON.stringify(JSON.parse(sourceString), null, 2);
  json = json.replaceAll(`"__proto__":`, `["__proto__"]:`);
  return `export default ${json};`;
}

// src/native_loader.ts
import { readFile } from "fs/promises";
async function load(infoCache, url, options) {
  switch (url.protocol) {
    case "http:":
    case "https:":
    case "data:":
      return await loadFromCLI(infoCache, url, options);
    case "file:": {
      const res = await loadFromCLI(infoCache, url, options);
      res.watchFiles = [fromFileUrl(url.href)];
      return res;
    }
  }
  return null;
}
async function loadFromCLI(infoCache, specifier, options) {
  const specifierRaw = specifier.href;
  if (!infoCache.has(specifierRaw)) {
    const { modules, redirects } = await info(specifier, {
      importMap: options.importMapURL?.href
    });
    for (const module2 of modules) {
      infoCache.set(module2.specifier, module2);
    }
    for (const [specifier2, redirect] of Object.entries(redirects)) {
      const redirected = infoCache.get(redirect);
      if (!redirected) {
        throw new TypeError("Unreachable.");
      }
      infoCache.set(specifier2, redirected);
    }
  }
  const module = infoCache.get(specifierRaw);
  if (!module) {
    throw new TypeError("Unreachable.");
  }
  if (module.error)
    throw new Error(module.error);
  if (!module.local)
    throw new Error("Module not downloaded yet.");
  const mediaType = module.mediaType ?? "Unknown";
  const loader = mediaTypeToLoader(mediaType);
  const raw = await readFile(module.local);
  const contents = transformRawIntoContent(raw, mediaType);
  return { contents, loader };
}

// src/portable_loader.ts
import { readFile as readFile2 } from "fs/promises";
async function load2(url, _options) {
  switch (url.protocol) {
    case "http:":
    case "https:":
    case "data:":
      return await loadWithFetch(url);
    case "file:": {
      const res = await loadWithReadFile(url);
      res.watchFiles = [fromFileUrl(url.href)];
      return res;
    }
  }
  return null;
}
async function loadWithFetch(specifier) {
  const specifierRaw = specifier.href;
  const resp = await fetch(specifierRaw);
  if (!resp.ok) {
    throw new Error(
      `Encountered status code ${resp.status} while fetching ${specifierRaw}.`
    );
  }
  const contentType = resp.headers.get("content-type");
  const mediaType = mapContentType(
    new URL(resp.url || specifierRaw),
    contentType
  );
  const loader = mediaTypeToLoader(mediaType);
  const raw = new Uint8Array(await resp.arrayBuffer());
  const contents = transformRawIntoContent(raw, mediaType);
  return { contents, loader };
}
async function loadWithReadFile(specifier) {
  const path = fromFileUrl(specifier);
  const mediaType = mapContentType(specifier, null);
  const loader = mediaTypeToLoader(mediaType);
  const raw = await readFile2(path);
  const contents = transformRawIntoContent(raw, mediaType);
  return { contents, loader };
}
function mapContentType(specifier, contentType) {
  if (contentType !== null) {
    const contentTypes = contentType.split(";");
    const mediaType = contentTypes[0].toLowerCase();
    switch (mediaType) {
      case "application/typescript":
      case "text/typescript":
      case "video/vnd.dlna.mpeg-tts":
      case "video/mp2t":
      case "application/x-typescript":
        return mapJsLikeExtension(specifier, "TypeScript");
      case "application/javascript":
      case "text/javascript":
      case "application/ecmascript":
      case "text/ecmascript":
      case "application/x-javascript":
      case "application/node":
        return mapJsLikeExtension(specifier, "JavaScript");
      case "text/jsx":
        return "JSX";
      case "text/tsx":
        return "TSX";
      case "application/json":
      case "text/json":
        return "Json";
      case "application/wasm":
        return "Wasm";
      case "text/plain":
      case "application/octet-stream":
        return mediaTypeFromSpecifier(specifier);
      default:
        return "Unknown";
    }
  } else {
    return mediaTypeFromSpecifier(specifier);
  }
}
function mapJsLikeExtension(specifier, defaultType) {
  const path = specifier.pathname;
  switch (extname(path)) {
    case ".jsx":
      return "JSX";
    case ".mjs":
      return "Mjs";
    case ".cjs":
      return "Cjs";
    case ".tsx":
      return "TSX";
    case ".ts":
      if (path.endsWith(".d.ts")) {
        return "Dts";
      } else {
        return defaultType;
      }
    case ".mts": {
      if (path.endsWith(".d.mts")) {
        return "Dmts";
      } else {
        return defaultType == "JavaScript" ? "Mjs" : "Mts";
      }
    }
    case ".cts": {
      if (path.endsWith(".d.cts")) {
        return "Dcts";
      } else {
        return defaultType == "JavaScript" ? "Cjs" : "Cts";
      }
    }
    default:
      return defaultType;
  }
}
function mediaTypeFromSpecifier(specifier) {
  const path = specifier.pathname;
  switch (extname(path)) {
    case "":
      if (path.endsWith("/.tsbuildinfo")) {
        return "TsBuildInfo";
      } else {
        return "Unknown";
      }
    case ".ts":
      if (path.endsWith(".d.ts")) {
        return "Dts";
      } else {
        return "TypeScript";
      }
    case ".mts":
      if (path.endsWith(".d.mts")) {
        return "Dmts";
      } else {
        return "Mts";
      }
    case ".cts":
      if (path.endsWith(".d.cts")) {
        return "Dcts";
      } else {
        return "Cts";
      }
    case ".tsx":
      return "TSX";
    case ".js":
      return "JavaScript";
    case ".jsx":
      return "JSX";
    case ".mjs":
      return "Mjs";
    case ".cjs":
      return "Cjs";
    case ".json":
      return "Json";
    case ".wasm":
      return "Wasm";
    case ".tsbuildinfo":
      return "TsBuildInfo";
    case ".map":
      return "SourceMap";
    default:
      return "Unknown";
  }
}

// src/node.ts
var getNodeModulesPath = async (moduleName) => {
  if (!globalThis.require && import.meta.url) {
    const module = await import("module");
    const { createRequire } = module.default;
    globalThis.require = createRequire(import.meta.url);
  }
  try {
    const mod = __require.resolve(moduleName);
    return mod;
  } catch (error) {
    return null;
  }
};

// mod.ts
import { existsSync } from "fs";
import { readFile as readFile3, realpath } from "fs/promises";
import { transformExtern } from "@gjsify/esbuild-plugin-deepkit";
var DEFAULT_LOADER = "portable";
function denoPlugin(options = {}) {
  const loader = options.loader ?? DEFAULT_LOADER;
  return {
    name: "deno",
    setup(build) {
      const infoCache = /* @__PURE__ */ new Map();
      let importMap = null;
      build.onStart(async function onStart() {
        if (options.importMapURL !== void 0) {
          let txt;
          if (options.importMapURL.href.startsWith("file://")) {
            const url = new URL(options.importMapURL.href);
            txt = await readFile3(url.pathname, { encoding: "utf-8" });
          } else {
            const resp = await fetch(options.importMapURL.href);
            txt = await resp.text();
          }
          importMap = resolveImportMap(JSON.parse(txt), options.importMapURL);
        } else {
          importMap = null;
        }
      });
      build.onResolve({ filter: /.*/ }, async function onResolve(args) {
        if (args.kind === "import-statement" || args.kind === "require-call") {
          const nodeModulePath = await getNodeModulesPath(args.path);
          if (nodeModulePath) {
            return null;
          }
        }
        if (args.path.endsWith("/")) {
          return null;
        }
        if (args.path.startsWith("gi://")) {
          return {
            path: args.path,
            external: true
          };
        }
        if (args.path.startsWith("ext:")) {
          const path2 = args.path;
          let importModule;
          if (path2.startsWith("ext:deno_node/")) {
            importModule = path2.replace(/^ext:deno_node\//, "@gjsify/deno-runtime-2/ext/node/polyfills/");
          } else if (path2.startsWith("ext:deno_")) {
            importModule = path2.replace(/^ext:deno_/, "@gjsify/deno-runtime-2/ext/");
          } else if (path2.startsWith("ext:runtime/")) {
            importModule = path2.replace(/^ext:runtime\//, "@gjsify/deno-runtime-2/runtime/js/");
          } else if (path2.startsWith("ext:core/")) {
            importModule = path2.replace(/^ext:core\//, "@gjsify/deno-core/");
          } else {
            throw new Error(`Unknown ext: module ${path2}`);
          }
          importModule = importModule.replace(/\.ts$/, ".js");
          try {
            const resolvedModule = await build.resolve(importModule, {
              importer: args.importer,
              kind: args.kind,
              namespace: args.namespace,
              resolveDir: args.resolveDir,
              pluginData: args.pluginData
            });
            if (resolvedModule.errors.length > 0) {
              console.error(resolvedModule.errors);
            }
            return resolvedModule;
          } catch (error) {
            console.error(error);
            throw error;
          }
        }
        const resolveDir = args.resolveDir ? `${toFileUrl(args.resolveDir).href}/` : "";
        const referrer = args.importer ? `${args.namespace}:${args.importer}` : resolveDir;
        let resolved;
        if (importMap !== null) {
          const res = resolveModuleSpecifier(
            args.path,
            importMap,
            new URL(referrer) || void 0
          );
          resolved = new URL(res);
        } else {
          resolved = new URL(args.path, referrer);
        }
        const protocol = resolved.protocol;
        if (protocol === "file:") {
          let path2 = fromFileUrl(resolved);
          if (existsSync(path2)) {
            path2 = await realpath(path2);
            return { path: path2, namespace: "file" };
          } else {
            return null;
          }
        }
        const path = resolved.href.slice(protocol.length);
        return { path, namespace: protocol.slice(0, -1) };
      });
      async function onLoad(args) {
        let url;
        if (args.namespace === "file") {
          url = toFileUrl(args.path);
        } else {
          url = new URL(`${args.namespace}:${args.path}`);
        }
        let result = null;
        switch (loader) {
          case "native":
            result = await load(infoCache, url, options);
          case "portable":
            result = await load2(url, options);
        }
        if (result?.contents && options.reflection) {
          return transformExtern(options, args, result);
        }
        return result;
      }
      build.onLoad({ filter: /.*\.json/, namespace: "file" }, onLoad);
      build.onLoad({ filter: /.*/, namespace: "http" }, onLoad);
      build.onLoad({ filter: /.*/, namespace: "https" }, onLoad);
      build.onLoad({ filter: /.*/, namespace: "data" }, onLoad);
    }
  };
}

// test_deps.ts
import * as esbuild4 from "esbuild";
import {
  equal,
  deepEqual as assertEquals,
  throws as assertThrows
} from "assert";
var assert = (test2) => {
  return equal(test2, true);
};

// mod_test.ts
import crypto from "crypto";
if (!globalThis.crypto) {
  globalThis.crypto = crypto;
}
var ALL = ["native", "portable"];
function test(name, loaders, fn) {
  for (const loader of loaders) {
    Deno.test(`[${loader}] ${name}`, async () => {
      try {
        await fn(loader);
      } finally {
      }
    });
  }
}
test("remote ts", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: ["https://deno.land/std@0.173.0/collections/without_all.ts"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { withoutAll } = await import(dataURL);
  assertEquals(withoutAll([1, 2, 3], [2, 3, 4]), [1]);
});
test("local ts", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: ["./testdata/mod.ts"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { bool } = await import(dataURL);
  assertEquals(bool, "asd2");
});
test("remote mts", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: [
      "https://gist.githubusercontent.com/lucacasonato/4ad57db57ee8d44e4ec08d6a912e93a7/raw/f33e698b4445a7243d72dbfe95afe2d004c7ffc6/mod.mts"
    ]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { bool } = await import(dataURL);
  assertEquals(bool, "asd2");
});
test("local mts", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: ["./testdata/mod.mts"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { bool } = await import(dataURL);
  assertEquals(bool, "asd2");
});
test("remote js", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: ["https://crux.land/266TSp"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { bool } = await import(dataURL);
  assertEquals(bool, "asd");
});
test("local js", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: ["./testdata/mod.js"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { bool } = await import(dataURL);
  assertEquals(bool, "asd");
});
test("remote mjs", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: [
      "https://gist.githubusercontent.com/lucacasonato/4ad57db57ee8d44e4ec08d6a912e93a7/raw/f33e698b4445a7243d72dbfe95afe2d004c7ffc6/mod.mjs"
    ]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { bool } = await import(dataURL);
  assertEquals(bool, "asd");
});
test("local mjs", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: ["./testdata/mod.mjs"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { bool } = await import(dataURL);
  assertEquals(bool, "asd");
});
test("remote jsx", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: ["https://crux.land/GeaWJ"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const m = await import(dataURL);
  assertEquals(m.default, "foo");
});
test("local jsx", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: ["./testdata/mod.jsx"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const m = await import(dataURL);
  assertEquals(m.default, "foo");
});
test("remote tsx", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: ["https://crux.land/2Qjyo7"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const m = await import(dataURL);
  assertEquals(m.default, "foo");
});
test("local tsx", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    entryPoints: ["./testdata/mod.tsx"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const m = await import(dataURL);
  assertEquals(m.default, "foo");
});
test("bundle remote imports", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    bundle: true,
    platform: "neutral",
    entryPoints: ["https://deno.land/std@0.173.0/uuid/mod.ts"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { v1 } = await import(dataURL);
  assert(v1.validate(v1.generate()));
});
var importMapURL = new URL("./testdata/importmap.json", import.meta.url);
test("bundle import map", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [
      denoPlugin({ importMapURL, loader })
    ],
    write: false,
    bundle: true,
    platform: "neutral",
    entryPoints: ["./testdata/importmap.js"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { bool } = await import(dataURL);
  assertEquals(bool, "asd2");
});
test("local json", ALL, async (loader) => {
  const res = await esbuild4.build({
    plugins: [denoPlugin({ loader })],
    write: false,
    format: "esm",
    entryPoints: ["./testdata/data.json"]
  });
  assertEquals(res.warnings, []);
  assertEquals(res.outputFiles.length, 1);
  const output = res.outputFiles[0];
  assertEquals(output.path, "<stdout>");
  const dataURL = `data:application/javascript;base64,${btoa(output.text)}`;
  const { default: data } = await import(dataURL);
  assertEquals(data, {
    "hello": "world",
    ["__proto__"]: {
      "sky": "universe"
    }
  });
});
