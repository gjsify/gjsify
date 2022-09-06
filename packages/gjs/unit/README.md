# gjsunit

## What it is
gjsunit is a BDD-style testing framework for the gjs Javascript binding for Gnome 3 which can be used to write Gnome 3 applications and extensions. It's syntax is totally stolen from [Jasmine](http://jasmine.github.io/) ;-).

## How to use it
Using gjsunit is very easy. You only need the gjsunit.js file which you can put anywhere into your application/extension directory. Let's assume you put it into `lib/gjsunit.js`.
You can run gjsunit from the command line by first cd-ing into your application/extension directory and then running `gjs lib/gjsunit.js`. gsjunit will assume a `test`-directory in your project directory and will scan the whole directory for any executable testsuites which it will then run. You can provide a different test-directory as a parameter if you wish: `gjs lib/gjsunit.js myTests`.
Since you probably dont have any test suites yet, let's look into how to do this.

## Writing test suites

In your test directory you can have as many subdirectories and test files as you wish. gjsunit will just run all of them.
A test suite could look like this:

```js
// test/MyModuleTest.js

const MyModule = imports.MyModule;

function testSuite() {

	describe('MyModule', function() {
		it('should say hello', function() {
			var module = new MyModule();

			expect(module.hello()).toEqual('hello');
			expect(module.hello()).not.toEqual('hi');
		});
	});

}
```

Your test files must expose a function called `testSuite`. This is the function gjsunit will call. In your test suite you can use `describe` and `it` to cluster your test suite. You can then use `expect` to capture the value you want to express expectations on. The available methods for expressing expectations are:
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

I recommend looking at the test suite for examples.

Happy testing!

## Known problems

Apparently it is impossible for gjs to import some things (For example imports.gi.St). I haven't found a solution to solve this yet, so until then you will only be able to test files which dont import any stuff gjs cant import. Extracting your code that doesnt rely on these imports into own modules circumvents this problem.

