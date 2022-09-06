// ../../gjs/unit/dist/index.cjs
var import_process = require("process");
var mainloop = globalThis?.imports?.mainloop;
var countTestsOverall = 0;
var countTestsFailed = 0;
var print = globalThis.print || console.log;
var runTests = async function(namespaces) {
  for (var subNamespace in namespaces) {
    const namespace = namespaces[subNamespace];
    if (typeof namespace === "function") {
      await namespace();
    } else if (typeof namespace === "object") {
      await runTests(namespace);
    }
  }
};
var printResult = () => {
  if (countTestsFailed) {
    print("\n\x1B[31m\u274C " + countTestsFailed + " of " + countTestsOverall + " tests failed\x1B[39m");
  } else {
    print("\n\x1B[32m\u2714 " + countTestsOverall + " completed\x1B[39m");
  }
};
var printRuntime = () => {
  if (import_process.versions.gjs) {
    print(`Running on Gjs ${import_process.versions.gjs}`);
  } else if (import_process.versions.node) {
    print(`Running on Node.js ${import_process.versions.node}`);
  } else {
    print(`Running on unknown runtime`);
  }
};
var run = function(namespaces) {
  printRuntime();
  runTests(namespaces).then(() => {
    printResult();
    print();
    mainloop?.quit();
  });
  mainloop?.run();
};

// src/test.ts
run({});
//# sourceMappingURL=test.node.cjs.map
