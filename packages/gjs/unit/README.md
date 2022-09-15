# @gjsify/unit

A BDD-style testing framework for Gjs, Deno and Node.js, forked from [gjsunit](https://github.com/philipphoffmann/gjsunit).

## What it is
unit is a BDD-style testing framework for the gjs Javascript binding for Gnome 4x which can be used to write Gnome 4x applications and extensions. It's syntax is totally stolen from [Jasmine](http://jasmine.github.io/) ;-).

## How to use it

First you need to install the package together with `@gjsify/cli`:

```bash
yarn install @gjsify/cli @gjsify/unit -D
```

After that you can build and run your tests:

```bash
gjsify build test-runner.ts --platform gjs --outfile test.gjs.js
gjs -m test.gjs.js
```

## Writing test suites

In your test directory you can have as many subdirectories and test files as you wish. unit will just run all of them.
A test suite could look like this:

```js
// my-module.spec.ts

import { describe, it, expect } from '@gjsify/unit';
import MyModule from './my-module.js';

export default async () => {

	await describe('MyModule', async () => {
		await it('should say hello', async () => {
			var module = new MyModule();

			expect(module.hello()).toEqual('hello');
			expect(module.hello()).not.toEqual('hi');
		});
	});

}
```

```js
// test-runner.ts

import { run } from '@gjsify/unit';
import myTestSuite from './my-module.spec.ts';

run({myTestSuite});
```


Your test files must expose a function. This is the function you will call in your test runner. In your test suite you can use `describe` and `it` to cluster your test suite. You can then use `expect` to capture the value you want to express expectations on. The available methods for expressing expectations are:
- `toBe(value)` (checks using ===)
- `toEqual(value)` (checks using ==)
- `toMatch(regex)` (checks using String.prototype.match and a regular expression)
- `toBeDefined()` (checks whether the actual value is defined)
- `toBeUndefined()` (opposite of the above)
- `toBeNull()` (checks whether the actual value is null)
- `toBeTruthy()` (checks whether the actual value is castable to true)
- `toBeFalsy()` (checks whether the actual value is castable to false)
- `toContain(needle)` (checks whether an array contains the needle value)
- `toBeLessThan(value)`
- `toBeGreaterThan(value)`
- `toBeCloseTo(value, precision)` (can check float values until a given precision)
- `to(callback)` (checks the value using the provided callback (which gets passed the actual value as first parameter))

There is also a `spy` method with which the call of methods can be checked, this is forked from [mysticatea/spy](https://github.com/mysticatea/spy).

```js
// spy.spec.ts

import { describe, it, expect, spy } from '@gjsify/unit';

export default async () => {
    await describe("'spy' function", async () => {
        await it("should have a calls length of 1 after called one time.", async () => {
            const f = spy()
            f()

            expect(f.calls.length).toBe(1)
        })
	})
}
```

I recommend looking at the test suite for examples.

Happy testing!


