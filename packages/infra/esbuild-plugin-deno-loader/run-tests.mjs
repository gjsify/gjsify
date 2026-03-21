// run-tests.ts
import { readdirSync } from "fs";
import { types } from "util";
import { resolve } from "path";
var regex = /(test|spec).(m|c)?(j)sx?$/m;
var arg = process.argv.slice(2)[0];
var dir = resolve(process.cwd() || "", arg || "");
console.log("Running tests in", dir);
var files = readdirSync(dir).filter((file) => regex.test(file));
var tests = [];
globalThis.Deno = {};
globalThis.Deno.test = function test(name, fn) {
  tests.push({ name, fn });
};
async function run() {
  await Promise.all(files.map((file) => import("file://" + dir + "/" + file))).catch(
    (e) => console.error(e)
  );
  tests.forEach((t) => {
    if (types.isAsyncFunction(t.fn)) {
      t.fn().then(() => console.log("\u2705", t.name)).catch((e) => {
        console.log("\u274C", t.name);
        console.log(e.stack);
      });
    } else {
      try {
        t.fn();
        console.log("\u2705", t.name);
      } catch (e) {
        console.log("\u274C", t.name);
        console.log(e.stack);
      }
    }
  });
}
try {
  run();
} catch (error) {
  console.error(error);
}
