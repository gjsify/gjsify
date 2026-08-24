// The Vue type surface, brought into this program.
//
// `@gjsify/gtk-host/vue-components` augments `@vue/runtime-core`'s
// `GlobalComponents` with one key per GType, and an augmentation only applies to a
// program that LOADS it. Spelled here rather than as a bare `import` in `app.ts`
// because it carries no runtime value at all: the module is types only, so an
// import in shipping source would be a side-effect import with no side effect.
import '@gjsify/gtk-host/vue-components';
