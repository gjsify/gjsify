import { describe, it, expect, assert } from '@gjsify/unit';

// TODO add a fake module for node and deno to run this tests also in his runtime?
import { AbortController, AbortSignal } from '@gjsify/abort-controller';

const HAS_EVENT_TARGET_INTERFACE = typeof EventTarget !== "undefined"

export default async () => {

	// Credits https://github.com/mysticatea/abort-controller/tree/master/test

	await describe('AbortController', async () => {
		await it('should have a callable constructor', async () => {
			expect(() => {
				new AbortController();
			}).not.toThrow();
		});

		await it('should not be callable', async () => {
			expect(AbortController).toThrow();
		});

		await it('should have 2 properties', async () => {
			const controller = new AbortController();

			const keys = new Set()
			keys.add("signal")
			keys.add("abort")
	
			for (const key in controller) {
				assert(keys.has(key), `'${key}' found, but should not have it`);
				keys.delete(key)
			}

			keys.forEach((key) => {
				assert(false, `'${key}' not found`);
			})
		});

		// TODO
		// await it('should be stringified as [object AbortController]', async () => {
		// 	const controller = new AbortController();
		// 	expect(controller.toString()).toBe("[object AbortController]")
		// });

		await describe("'signal' property", async () => {
			const controller = new AbortController();
			const signal = controller.signal
	
			await it("should return the same instance always", async () => {
				expect(signal === controller.signal).toBeTruthy()
			})
	
			await it("should be a AbortSignal object", async () => {
				expect(signal instanceof AbortSignal).toBeTruthy()
			})

			if(HAS_EVENT_TARGET_INTERFACE) {
				await it("should be a EventTarget object", async () => {
					expect(signal instanceof EventTarget).toBeTruthy()
				})
			}
	
			await it("should have 5 properties", async () => {
				const keys = new Set<string>()
				keys.add("addEventListener")
				keys.add("removeEventListener")
				keys.add("dispatchEvent")
				keys.add("aborted")
				keys.add("onabort")
	
				// TODO
				// for (const key in signal) {
				// 	assert(keys.has(key), `'${key}' found, but should not have it`);
				// 	keys.delete(key)
				// }
	
				keys.forEach(key => {
					// WORKAROUND for getter / setter
					const exists = (signal as any)[key] !== undefined;

					assert(exists, `'${key}' not found, but should have it: `);
				})
			})
	
			await it("should have 'aborted' property which is false by default", async () => {
				expect(signal.aborted).toBeFalsy();
			})
	
			await it("should have 'onabort' property which is null by default", async () => {
				// TODO:
				expect((signal as any).onabort).toBeNull()
			})
	
			await it("should throw a TypeError if 'signal.aborted' getter is called with non AbortSignal object", async () => {
				const getAborted = Object.getOwnPropertyDescriptor(
					(signal as any).__proto__,
					"aborted",
				)!.get

				expect(() => {
					getAborted!.call({})
				}).toThrow(TypeError);
			});

			await it("should be stringified as [object AbortSignal]", async () => {
				expect(signal.toString()).toBe("[object AbortSignal]")
			});
		});

		await describe("'abort' method", async () => {

			await it("should set true to 'signal.aborted' property", async () => {
				const controller = new AbortController();

				controller.abort()
				assert(controller.signal.aborted)
			})
	
			await it("should fire 'abort' event on 'signal' (addEventListener)", async () => {
				const controller = new AbortController();

				let calls = 0;
				controller.signal.addEventListener("abort", () => {
					++calls;
				});
				controller.abort()
	
				assert(calls === 1)
			})
	
			await it("should fire 'abort' event on 'signal' (onabort)", async () => {
				const controller = new AbortController();

				let calls = 0;
				// TODO:
				(controller.signal as any).onabort = () => {
					++calls;
				}
				controller.abort()
	
				assert(calls === 1)
			})
	
			await it("should not fire 'abort' event twice", async () => {
				const controller = new AbortController();

				let calls = 0;
				controller.signal.addEventListener("abort", () => {
					++calls;
				});
				controller.abort()
				controller.abort()
				controller.abort()
	
				assert(calls === 1)
			})
	
			await it("should throw a TypeError if 'this' is not an AbortController object", async () => {
				const controller = new AbortController();

				expect(() => {
					controller.abort.call({})
				}).toThrow(TypeError)
			})
		})

	});
}
