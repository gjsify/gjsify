// StoryRegistry — collects web story modules and instantiates their elements.
// The web counterpart of @gjsify/storybook's StoryRegistryService (one per run,
// no shared singleton).

import type { StoryElement } from './story-element.js';
import type { WebStoryModule } from './types.js';

export class StoryRegistry {
    private modules: WebStoryModule[] = [];

    /** Register multiple story modules (invalid ones are filtered out). */
    registerStories(storyModules: WebStoryModule[]): void {
        if (!Array.isArray(storyModules)) {
            console.warn('Invalid story modules array provided to registerStories');
            return;
        }
        const valid = storyModules.filter((module) => module && Array.isArray(module.stories));
        this.modules.push(...valid);
    }

    /** All registered story modules (a shallow copy). */
    getStories(): WebStoryModule[] {
        return [...this.modules];
    }

    /** Instantiate every registered story element and run its initialize(). */
    createStoryInstances(): WebStoryModule[] {
        for (const module of this.modules) {
            this.instantiateStoriesForModule(module);
        }
        return [...this.modules];
    }

    private instantiateStoriesForModule(module: WebStoryModule): void {
        if (!module.instances) {
            module.instances = [];
        }

        const decorators = module.decorators ?? [];

        for (const StoryClass of module.stories) {
            try {
                const instance: StoryElement = new StoryClass();

                const build = (): void => {
                    instance.initialize();
                };
                const run = decorators.reduceRight<() => void>(
                    (next, decorator) => () => decorator(next, instance),
                    build,
                );
                run();

                module.instances.push(instance);
            } catch (error) {
                console.error(`Failed to instantiate story element: ${StoryClass.name || 'Unknown'}`, error);
            }
        }
    }
}
