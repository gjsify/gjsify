import { describe, it, expect } from 'jasmine'

import process from '@gjsify/process';

// process.on('exit', code => console.log('bye bye: ' + code));

// Object.keys(process).forEach(key => {
//   switch (key) {
//     case 'abort':
//     case 'env':
//     case 'exit':
//     case 'nextTick':
//       return;
//   }
//   console.log(key, typeof process[key] === 'function' ? process[key]() : process[key]);
// });

// process.nextTick(process.exit, 0);

// assert.deepEqual(process.argv.splice(2),  ["--foo", "bar"]);


describe("Progress", function() {
  it("process.arch should be a string", function() {
    expect(typeof process.arch).toBe("string");
  });
});

