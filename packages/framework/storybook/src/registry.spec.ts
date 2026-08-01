// StoryRegistryService — registration + instantiation + decorator composition.
// Uses fake story classes (no GTK) so it runs headless.

import { describe, expect, it } from '@gjsify/unit';
import { StoryRegistryService } from './registry.js';
import type { StoryDecorator, StoryModule } from './story-widget.js';

// Minimal fake satisfying the structural shape the registry uses.
class FakeStory {
    initialized = false;
    static getMetadata() {
        return { title: 'Test/Fake' };
    }
    initialize(): void {
        this.initialized = true;
    }
}

function moduleOf(stories: unknown[], decorators?: StoryDecorator[]): StoryModule {
    return { stories, decorators } as unknown as StoryModule;
}

export default async () => {
    await describe('StoryRegistryService — registration', async () => {
        await it('keeps valid modules and rejects invalid ones', async () => {
            const registry = new StoryRegistryService();
            registry.registerStory(moduleOf([FakeStory]));
            registry.registerStory({ stories: 'nope' } as unknown as StoryModule);
            registry.registerStories([moduleOf([FakeStory]), { foo: 1 } as unknown as StoryModule]);
            expect(registry.getStories().length).toBe(2);
        });

        await it('getStories returns a defensive copy', async () => {
            const registry = new StoryRegistryService();
            registry.registerStory(moduleOf([FakeStory]));
            const a = registry.getStories();
            a.push(moduleOf([FakeStory]));
            expect(registry.getStories().length).toBe(1);
        });
    });

    await describe('StoryRegistryService — instantiation', async () => {
        await it('constructs instances and calls initialize()', async () => {
            const registry = new StoryRegistryService();
            registry.registerStory(moduleOf([FakeStory, FakeStory]));
            const [module] = registry.createStoryInstances();
            const instances = module.instances ?? [];
            expect(instances.length).toBe(2);
            expect((instances[0] as unknown as FakeStory).initialized).toBeTruthy();
        });

        await it('runs module decorators around initialize in order', async () => {
            const order: string[] = [];
            class Traced {
                static getMetadata() {
                    return { title: 'Test/Traced' };
                }
                initialize(): void {
                    order.push('init');
                }
            }
            const outer: StoryDecorator = (build) => {
                order.push('outer:before');
                build();
                order.push('outer:after');
            };
            const inner: StoryDecorator = (build) => {
                order.push('inner:before');
                build();
                order.push('inner:after');
            };
            const registry = new StoryRegistryService();
            registry.registerStory(moduleOf([Traced], [outer, inner]));
            registry.createStoryInstances();
            expect(order).toStrictEqual(['outer:before', 'inner:before', 'init', 'inner:after', 'outer:after']);
        });
    });
};
