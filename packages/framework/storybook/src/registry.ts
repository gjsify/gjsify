// StoryRegistryService — collects story modules and instantiates their widgets.
// original implementation. GTK-free at import time (the widget classes it
// instantiates pull in GTK, but importing this module does not).

import type { StoryModule } from './story-widget.js';

/**
 * Manages story-module registration and instantiation. Unlike the original
 * PixelRPG implementation there is no exported singleton — each
 * {@link runStorybook} run owns exactly one registry, which removes the
 * double-registration footgun.
 */
export class StoryRegistryService {
    private modules: StoryModule[] = [];

    /** Register a single story module. */
    registerStory(storyModule: StoryModule): void {
        if (!storyModule || !Array.isArray(storyModule.stories)) {
            console.warn('Invalid story module provided to registerStory');
            return;
        }
        this.modules.push(storyModule);
    }

    /** Register multiple story modules (invalid ones are filtered out). */
    registerStories(storyModules: StoryModule[]): void {
        if (!Array.isArray(storyModules)) {
            console.warn('Invalid story modules array provided to registerStories');
            return;
        }
        const valid = storyModules.filter((module) => module && Array.isArray(module.stories));
        this.modules.push(...valid);
    }

    /** All registered story modules (a shallow copy). */
    getStories(): StoryModule[] {
        return [...this.modules];
    }

    /**
     * Instantiate every registered story widget and prepare it for display.
     * Call once GTK is ready.
     */
    createStoryInstances(): StoryModule[] {
        for (const module of this.modules) {
            this.instantiateStoriesForModule(module);
        }
        return [...this.modules];
    }

    private instantiateStoriesForModule(module: StoryModule): void {
        if (!module.instances) {
            module.instances = [];
        }

        const decorators = module.decorators ?? [];

        for (const StoryClass of module.stories) {
            try {
                const instance = new StoryClass();

                // Compose module decorators around the story's initialize().
                const build = (): void => {
                    if (typeof instance.initialize === 'function') {
                        instance.initialize();
                    }
                };
                const run = decorators.reduceRight<() => void>(
                    (next, decorator) => () => decorator(next, instance),
                    build,
                );
                run();

                module.instances.push(instance);
            } catch (error) {
                console.error(`Failed to instantiate story widget: ${StoryClass.name || 'Unknown'}`, error);
            }
        }
    }
}
