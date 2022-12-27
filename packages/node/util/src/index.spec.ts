import { describe, it, expect } from '@gjsify/unit';
import * as util from 'util';

// https://github.com/chalk/ansi-regex/blob/02fa893d619d3da85411acc8fd4e2eea0e95a9d9/index.js
const ANSI_PATTERN = new RegExp(
	[
	  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
	  "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
	].join("|"),
	"g",
);
  
// TODO build deno_std/fmt for this method
function stripColor(string: string): string {
	return string.replace(ANSI_PATTERN, "");
}
  

export default async () => {
	// See packages/deno/deno_std/original/node/util_test.ts
	await describe('[util] format', async () => {
		await it('should return the right result', async () => {
			expect(util.format("%o", [10, 11])).toBe("[ 10, 11, [length]: 2 ]");
		});
	});


	await describe("[util] inspect.custom", async () => {
		await it('should be the symbol for nodejs.util.inspect.custom', async () => {
			expect(util.inspect.custom.description).toEqual("nodejs.util.inspect.custom");
		});
	});

	await describe("[util] inspect", async () => {

		await it('should return the right results', async () => {
			expect(stripColor(util.inspect({ foo: 123 }))).toBe("{ foo: 123 }");
			expect(stripColor(util.inspect("Deno's logo is so cute."))).toBe(`"Deno's logo is so cute."`);
			expect(stripColor(util.inspect([1, 2, 3, 4, 5, 6, 7]))).toBe(`[
  1, 2, 3, 4,
  5, 6, 7
]`
			);
		});
	});

	await describe("[util] isBoolean", async () => {

		await it('should return the right results', async () => {
			expect(util.isBoolean(true)).toBeTruthy();
			// TODO: this is true in Gjs / Deno but false in Node.js
			// expect(util.isBoolean(new Boolean())).toBeTruthy();
			// expect(util.isBoolean(new Boolean(true))).toBeTruthy();
			expect(util.isBoolean(false)).toBeTruthy();
			expect(util.isBoolean("deno")).toBeFalsy();
			expect(util.isBoolean("true")).toBeFalsy();
		});
	});

	await describe("[util] isNull", async () => {
		await it('should return the right results', async () => {
			let n;
			expect(util.isNull(null)).toBeTruthy();
			expect(util.isNull(n)).toBeFalsy();
			expect(util.isNull(0)).toBeFalsy();
			expect(util.isNull({})).toBeFalsy();
		});
	});

	await describe("[util] isNullOrUndefined", async () => {
		await it('should return the right results', async () => {
			let n;
			expect(util.isNullOrUndefined(null)).toBeTruthy();
			expect(util.isNullOrUndefined(n)).toBeTruthy();
			expect(util.isNullOrUndefined({})).toBeFalsy();
			expect(util.isNullOrUndefined("undefined")).toBeFalsy();
		});
	});

	await describe("[util] isNumber", async () => {
		await it('should return the right results', async () => {
			expect(util.isNumber(666)).toBeTruthy();
			// TODO: this is true in Gjs / Deno but false in Node.js
			// expect(util.isNumber(new Number(666))).toBeTruthy();
			expect(util.isNumber("999")).toBeFalsy();
			expect(util.isNumber(null)).toBeFalsy();
		});
	});

	await describe("[util] isString", async () => {
		await it('should return the right results', async () => {
			expect(util.isString("deno")).toBeTruthy();
			// TODO: this is true in Gjs / Deno but false in Node.js
			// expect(util.isString(new String("DIO"))).toBeTruthy();
			expect(util.isString(1337)).toBeFalsy();
		});
	});

	await describe("[util] isSymbol", async () => {
		await it('should return the right results', async () => {
			expect(util.isSymbol(Symbol())).toBeTruthy();
			expect(util.isSymbol(123)).toBeFalsy();
			expect(util.isSymbol("string")).toBeFalsy();
		});
	});

	await describe("[util] isUndefined", async () => {
		await it('should return the right results', async () => {
			let t;
			expect(util.isUndefined(t)).toBeTruthy();
			expect(util.isUndefined("undefined")).toBeFalsy();
			expect(util.isUndefined({})).toBeFalsy();
		});
	});

	await describe("[util] isObject", async () => {
		await it('should return the right results', async () => {
			const dio = { stand: "Za Warudo" };
			expect(util.isObject(dio)).toBeTruthy();
			expect(util.isObject(new RegExp(/Toki Wo Tomare/))).toBeTruthy();
			expect(util.isObject("Jotaro")).toBeFalsy();
		});
	});

	await describe("[util] isError", async () => {
		await it('should return the right results', async () => {
			const java = new Error();
			const nodejs = new TypeError();
			const deno = "Future";
			expect(util.isError(java)).toBeTruthy();
			expect(util.isError(nodejs)).toBeTruthy();
			expect(util.isError(deno)).toBeFalsy();
		});
	});

	await describe("[util] isFunction", async () => {
		await it('should return the right results', async () => {
			const f = function () { };
			expect(util.isFunction(f)).toBeTruthy();
			expect(util.isFunction({})).toBeFalsy();
			expect(util.isFunction(new RegExp(/f/))).toBeFalsy();
		});
	});

	await describe("[util] isRegExp", async () => {
		await it('should return the right results', async () => {
			expect(util.isRegExp(new RegExp(/f/))).toBeTruthy();
			expect(util.isRegExp(/fuManchu/)).toBeTruthy();
			expect(util.isRegExp({ evil: "eye" })).toBeFalsy();
			expect(util.isRegExp(null)).toBeFalsy();
		});
	});

	await describe("[util] isArray", async () => {
		await it('should return the right results', async () => {
			expect(util.isArray([])).toBeTruthy();
			expect(util.isArray({ yaNo: "array" })).toBeFalsy();
			expect(util.isArray(null)).toBeFalsy();
		});
	});

	await describe("[util] isPrimitive", async () => {
		await it('should return the right results', async () => {
			const stringType = "hasti";
			const booleanType = true;
			const integerType = 2;
			const symbolType = Symbol("anything");

			const functionType = function doBest() { };
			const objectType = { name: "ali" };
			const arrayType = [1, 2, 3];

			expect(util.isPrimitive(stringType)).toBeTruthy();
			expect(util.isPrimitive(booleanType)).toBeTruthy();
			expect(util.isPrimitive(integerType)).toBeTruthy();
			expect(util.isPrimitive(symbolType)).toBeTruthy();
			expect(util.isPrimitive(null)).toBeTruthy();
			expect(util.isPrimitive(undefined)).toBeTruthy();
			expect(util.isPrimitive(functionType)).toBeFalsy();
			expect(util.isPrimitive(arrayType)).toBeFalsy();
			expect(util.isPrimitive(objectType)).toBeFalsy();
		});
	});

	await describe("[util] TextDecoder", async () => {
		await it('should return the right results', async () => {
			expect(util.TextDecoder === TextDecoder).toBeTruthy();
			const td: util.TextDecoder = new util.TextDecoder();
			expect(td instanceof TextDecoder).toBeTruthy();
		});
	});

	await describe("[util] TextEncoder", async () => {
		await it('should return the right results', async () => {
			expect(util.TextEncoder === TextEncoder).toBeTruthy();
			const te: util.TextEncoder = new util.TextEncoder();
			expect(te instanceof TextEncoder).toBeTruthy();
		});
	});

	await describe("[util] isDate", async () => {
		await it('should return the right results', async () => {
			// Test verifies the method is exposed. See _util/_util_types_test for details
			expect(util.types.isDate(new Date())).toBeTruthy();
		});
	});

	await describe("[util] getSystemErrorName()", async () => {
		await it('should return the right results', async () => {
			type FnTestInvalidArg = (code?: unknown) => void;

			expect(
			  () => (util.getSystemErrorName as FnTestInvalidArg)(),
			).toThrow();

			try {
				(util.getSystemErrorName as FnTestInvalidArg)()
			} catch (error) {
				expect(error instanceof Error).toBeTruthy();
				expect(error instanceof TypeError).toBeTruthy();
			}

			expect(
			  () => (util.getSystemErrorName as FnTestInvalidArg)(1),
			).toThrow();

			try {
				(util.getSystemErrorName as FnTestInvalidArg)(1)
			} catch (error) {
				expect(error instanceof Error).toBeTruthy();
				expect(error instanceof RangeError).toBeTruthy();
			}
		
			// FIXME: Returns undefined on Deno
			expect(util.getSystemErrorName(-424242)).toBe('Unknown system error -424242');
		
			// TODO
			const os = globalThis.process?.platform || (globalThis as any).Deno?.build?.os || 'linux';

			switch (os) {
			  case "win32":
			  case "windows" as any:
				expect(util.getSystemErrorName(-4091)).toBe("EADDRINUSE");
				break;
		
			  case "darwin":
				expect(util.getSystemErrorName(-48)).toBe("EADDRINUSE");
				break;
		
			  case "linux":
				expect(util.getSystemErrorName(-98)).toBe("EADDRINUSE");
				break;
			}
		});
	});
}
