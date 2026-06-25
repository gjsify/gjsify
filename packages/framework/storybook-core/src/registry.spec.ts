// @gjsify/storybook-core — StoryRegistry tests.
// Runs on GJS + Node + browser (pure TS, no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { StoryRegistry, type StoryModuleLike } from './registry.js';

/** Minimal story instance: records that initialize() ran. */
class FakeStory {
    initialized = false;
    initialize(): void {
        this.initialized = true;
    }
}

type FakeModule = StoryModuleLike<FakeStory, new () => FakeStory>;

export default async () => {
    await describe('StoryRegistry.registerStory / registerStories', async () => {
        await it('registers a valid module', () => {
            const registry = new StoryRegistry<FakeStory>();
            registry.registerStory({ stories: [FakeStory] });
            expect(registry.getStories().length).toBe(1);
        });

        await it('rejects a module without a stories array', () => {
            const registry = new StoryRegistry<FakeStory>();
            registry.registerStory({ stories: 'nope' } as unknown as FakeModule);
            expect(registry.getStories().length).toBe(0);
        });

        await it('filters invalid modules out of registerStories', () => {
            const registry = new StoryRegistry<FakeStory>();
            registry.registerStories([
                { stories: [FakeStory] },
                { stories: 'x' } as unknown as FakeModule,
                null as unknown as FakeModule,
                { stories: [FakeStory] },
            ]);
            expect(registry.getStories().length).toBe(2);
        });

        await it('rejects a non-array passed to registerStories', () => {
            const registry = new StoryRegistry<FakeStory>();
            registry.registerStories('nope' as unknown as FakeModule[]);
            expect(registry.getStories().length).toBe(0);
        });
    });

    await describe('StoryRegistry.getStories', async () => {
        await it('returns a defensive copy', () => {
            const registry = new StoryRegistry<FakeStory>();
            registry.registerStory({ stories: [FakeStory] });
            const a = registry.getStories();
            a.push({ stories: [FakeStory] });
            expect(registry.getStories().length).toBe(1);
        });
    });

    await describe('StoryRegistry.createStoryInstances', async () => {
        await it('instantiates each story and runs initialize()', () => {
            const registry = new StoryRegistry<FakeStory>();
            const module: FakeModule = { stories: [FakeStory, FakeStory] };
            registry.registerStory(module);
            const result = registry.createStoryInstances();
            expect(result[0]!.instances!.length).toBe(2);
            expect(result[0]!.instances!.every((i) => i.initialized)).toBe(true);
        });

        await it('isolates a throwing constructor (others still instantiate)', () => {
            class Throws {
                constructor() {
                    throw new Error('boom');
                }
                initialize(): void {}
            }
            const registry = new StoryRegistry<FakeStory>();
            registry.registerStory({ stories: [Throws as unknown as new () => FakeStory, FakeStory] });
            const result = registry.createStoryInstances();
            // Throws is dropped; the second story instantiates.
            expect(result[0]!.instances!.length).toBe(1);
            expect(result[0]!.instances![0]!.initialized).toBe(true);
        });
    });

    await describe('StoryRegistry decorator fold', async () => {
        await it('applies decorators reduceRight around initialize()', () => {
            const order: string[] = [];
            class Tracked {
                initialize(): void {
                    order.push('init');
                }
            }
            const registry = new StoryRegistry<Tracked>();
            registry.registerStory({
                stories: [Tracked],
                decorators: [
                    (build) => {
                        order.push('outer-before');
                        build();
                        order.push('outer-after');
                    },
                    (build) => {
                        order.push('inner-before');
                        build();
                        order.push('inner-after');
                    },
                ],
            });
            registry.createStoryInstances();
            // reduceRight folds so the FIRST decorator is the outermost wrapper.
            expect(order).toStrictEqual([
                'outer-before',
                'inner-before',
                'init',
                'inner-after',
                'outer-after',
            ]);
        });

        await it('passes the instance to each decorator', () => {
            const seen: Tracked2[] = [];
            class Tracked2 {
                initialize(): void {}
            }
            const registry = new StoryRegistry<Tracked2>();
            registry.registerStory({
                stories: [Tracked2],
                decorators: [(build, instance) => {
                    seen.push(instance);
                    build();
                }],
            });
            const result = registry.createStoryInstances();
            expect(seen.length).toBe(1);
            expect(seen[0]).toBe(result[0]!.instances![0]);
        });
    });
};
