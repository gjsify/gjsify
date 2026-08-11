// StoryRegistry — renderer-agnostic story-module registration + instantiation.
//
// No singleton: each storybook run owns exactly one registry, which is what removed the
// original double-registration footgun.

/**
 * A group of related story constructors plus optional module-level decorators wrapping
 * each story's `initialize()`.
 */
export interface StoryModuleLike<TInstance extends { initialize(): void }, TCtor extends new () => TInstance> {
    /** The story constructors in this module. */
    stories: TCtor[];
    /** Populated by {@link StoryRegistry.createStoryInstances}. */
    instances?: TInstance[];
    /** Decorators applied around every story's `initialize()` in this module. */
    decorators?: Array<(build: () => void, instance: TInstance) => void>;
}

/** Collects story modules and instantiates their stories. One per storybook run. */
export class StoryRegistry<TInstance extends { initialize(): void }> {
    private modules: StoryModuleLike<TInstance, new () => TInstance>[] = [];

    /** Register a single story module. */
    registerStory(storyModule: StoryModuleLike<TInstance, new () => TInstance>): void {
        if (!storyModule || !Array.isArray(storyModule.stories)) {
            console.warn('Invalid story module provided to registerStory');
            return;
        }
        this.modules.push(storyModule);
    }

    /** Register multiple story modules (invalid ones are filtered out). */
    registerStories(storyModules: StoryModuleLike<TInstance, new () => TInstance>[]): void {
        if (!Array.isArray(storyModules)) {
            console.warn('Invalid story modules array provided to registerStories');
            return;
        }
        const valid = storyModules.filter((module) => module && Array.isArray(module.stories));
        this.modules.push(...valid);
    }

    /** All registered story modules (a shallow copy). */
    getStories(): StoryModuleLike<TInstance, new () => TInstance>[] {
        return [...this.modules];
    }

    /** Instantiate every registered story and run its `initialize()`. */
    createStoryInstances(): StoryModuleLike<TInstance, new () => TInstance>[] {
        for (const module of this.modules) {
            this.instantiateStoriesForModule(module);
        }
        return [...this.modules];
    }

    private instantiateStoriesForModule(module: StoryModuleLike<TInstance, new () => TInstance>): void {
        // RESET, not accumulate. Story modules are imported once, so `module.instances`
        // outlives a registry: a second mount (a second runStorybook after NS page
        // re-navigation) would APPEND to the previous run's instances, and the controller
        // would then re-select a STALE instance still parented in the discarded tree —
        // "View already has a parent".
        module.instances = [];

        const decorators = module.decorators ?? [];

        for (const StoryClass of module.stories) {
            try {
                const instance: TInstance = new StoryClass();

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
                console.error(`Failed to instantiate story: ${StoryClass.name || 'Unknown'}`, error);
            }
        }
    }
}
