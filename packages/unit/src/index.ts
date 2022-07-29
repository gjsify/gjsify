// This file is part of the gjsunit framework
// Please visit https://github.com/philipphoffmann/gjsunit for more information

var countTestsOverall = 0;
var countTestsFailed = 0;

// Makes this work on Gjs and Node.js
const print = globalThis.print || console.log;

class MatcherFactory {

	public not?: MatcherFactory;

	constructor(protected readonly actualValue: any, protected readonly positive: boolean, withOpposite = true) {
		if (withOpposite) {
			this.not = new MatcherFactory(actualValue, !positive, false);
		}
	}

	triggerResult(success: boolean, msg: string) {
		if( (success && !this.positive) ||
			(!success && this.positive) ) {
			++countTestsFailed;
			throw new Error(msg);
		}
	}

	to(callback: (actualValue: any) => boolean) {
		this.triggerResult(callback(this.actualValue),
			'      Expected callback to validate'
		);
	}

	toBe(expectedValue: any) {
		this.triggerResult(this.actualValue === expectedValue,
			'      Expected values to match using ===\n' +
			'      Expected: ' + expectedValue + '\n' +
			'      Actual: ' + this.actualValue
		);
	}

	toEqual(expectedValue: any) {
		this.triggerResult(this.actualValue == expectedValue,
			'      Expected values to match using ==\n' +
			'      Expected: ' + expectedValue + '\n' +
			'      Actual: ' + this.actualValue
		);
	}

	toMatch(expectedValue: any) {
		if(typeof this.actualValue.match !== 'function') {
			throw new Error(`You can not use toMatch on type ${typeof this.actualValue}`);
		}
		this.triggerResult(!!this.actualValue.match(expectedValue),
			'      Expected values to match using regular expression\n' +
			'      Expression: ' + expectedValue + '\n' +
			'      Actual: ' + this.actualValue
		);
	}

	toBeDefined() {
		this.triggerResult(typeof this.actualValue !== 'undefined',
			'      Expected value to be defined'
		);
	}

	toBeUndefined() {
		this.triggerResult(typeof this.actualValue === 'undefined',
			'      Expected value to be undefined'
		);
	}

	toBeNull() {
		this.triggerResult(this.actualValue === null,
			'      Expected value to be null'
		);
	}

	toBeTruthy() {
		this.triggerResult(this.actualValue as unknown as boolean,
			'      Expected value to be truthy'
		);
	}

	toBeFalsy() {
		this.triggerResult(!this.actualValue,
			'      Expected value to be falsy'
		);
	}

	toContain(needle: any) {
		this.triggerResult(this.actualValue instanceof Array && this.actualValue.indexOf(needle) !== -1,
			'      Expected ' + this.actualValue + ' to contain ' + needle
		);
	}
	toBeLessThan(greaterValue: number) {
		this.triggerResult(this.actualValue < greaterValue,
			'      Expected ' + this.actualValue + ' to be less than ' + greaterValue
		);
	}
	toBeGreaterThan(smallerValue: number) {
		this.triggerResult(this.actualValue > smallerValue,
			'      Expected ' + this.actualValue + ' to be greater than ' + smallerValue
		);
	}
	toBeCloseTo(expectedValue: number, precision: number) {
		var shiftHelper = Math.pow(10, precision);
		this.triggerResult(Math.round((this.actualValue as unknown as number) * shiftHelper) / shiftHelper === Math.round(expectedValue * shiftHelper) / shiftHelper,
			'      Expected ' + this.actualValue + ' with precision ' + precision + ' to be close to ' + expectedValue
		);
	}
	toThrow() {
		var didThrow = false;
		try {
			this.actualValue();
			didThrow = false;
		}
		catch(e) {
			didThrow = true;
		}

		this.triggerResult(didThrow,
			'      Expected ' + this.actualValue.name + ' to throw an exception'
		);
	}
}

export const describe = function(moduleName: string, callback: () => void) {
	print('\n' + moduleName);
	callback();
};

export const it = function(expectation: string, callback: () => void) {
	try {
		callback();
		print('  \x1B[32m✔\x1B[39m \x1B[90m' + expectation + '\x1B[39m');
	}
	catch(e) {
		print('  \x1B[31m❌\x1B[39m \x1B[90m' + expectation + '\x1B[39m');
		print('\x1B[31m' + e.message + '\x1B[39m');
	}
}

export const expect = function(actualValue: any) {
	++countTestsOverall;

	var expecter = new MatcherFactory(actualValue, true);

	return expecter;
}

const runTests = function(namespace) {
	// recursively check the test directory for executable tests
	for( var subNamespace in namespace ) {

		// execute any test functions
		if( subNamespace === 'testSuite' && typeof namespace[subNamespace] === 'function' ) {
			namespace[subNamespace]();
		}
		// descend into subfolders and objects
		else if( typeof namespace[subNamespace] === 'object' ) {
			runTests(namespace[subNamespace]);
		}
	}
}

const printResult = () => {
	if( countTestsFailed ) {
		// some tests failed
		print('\n\x1B[31m❌ ' + countTestsFailed + ' of ' + countTestsOverall + ' tests failed\x1B[39m');
	}
	else {
		// all tests okay
		print('\n\x1B[32m✔ ' + countTestsOverall + ' completed\x1B[39m');
	}
}

export const run = function(namespace) {
	runTests(namespace)
	printResult();
	print();	
}
