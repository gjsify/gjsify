// StoryRegistry — renderer-agnostic story-module registration + instantiation.
//
// Original implementation, extracted verbatim from the three renderers'
// registries (`StoryRegistryService` GTK / `StoryRegistry` browser / NS) which
// were byte-for-byte the same algorithm modulo the node type:
//   - registerStory / registerStories  (validate `Array.isArray(stories)`,
//     filter invalid, push)
//   - getStories()                      (defensive shallow copy)
//   - createStoryInstances()            (loop over modules)
//   - instantiateStoriesForModule()     (`new Ctor()`, decorator `reduceRight`
//     fold around `initialize()`, try/catch)
//
// No singleton — each storybook run owns exactly one registry (the GTK service
// removed the original PixelRPG double-registration footgun; the others followed).

/**
 * A story module — a group of related story constructors plus optional
 * module-level decorators wrapping each story's `initialize()`.
 *
 * @typeParam TInstance the renderer's story-instance type (it must expose
 *                      `initialize()`).
 * @typeParam TCtor     the zero-arg constructor producing `TInstance`.
 */
export interface StoryModuleLike<TInstance extends { initialize(): void }, TCtor extends new () => TInstance> {
    /** The story constructors in this module. */
    stories: TCtor[];
    /** Populated by {@link StoryRegistry.createStoryInstances}. */
    instances?: TInstance[];
    /** Decorators applied around every story's `initialize()` in this module. */
    decorators?: Array<(build: () => void, instance: TInstance) => void>;
}

/**
 * Collects story modules and instantiates their stories. One per storybook run
 * (no shared singleton).
 *
 * @typeParam TInstance the renderer's story-instance type.
 */
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
        // RESET (not accumulate): each createStoryInstances() must produce a FRESH
        // instance set. Story modules are shared singletons (imported once), so
        // `module.instances` survives across registries — a second mount (e.g. a
        // second runStorybook on NS page re-navigation/resume) would otherwise
        // APPEND to the previous run's instances, and the controller would re-select
        // a STALE instance whose view is still parented in the discarded tree → the
        // renderer crashes with "View already has a parent". Overwriting discards the
        // dead instances and binds the module to this run's views only.
        module.instances = [];

        const decorators = module.decorators ?? [];

        for (const StoryClass of module.stories) {
            try {
                const instance: TInstance = new StoryClass();

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
                console.error(`Failed to instantiate story: ${StoryClass.name || 'Unknown'}`, error);
            }
        }
    }
}
