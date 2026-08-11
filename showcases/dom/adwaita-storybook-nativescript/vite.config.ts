import { defineNativescriptConfig } from '@gjsify/nativescript-vite';

// `defineNativescriptConfig` composes @nativescript/vite and layers gjsify's NativeScript
// transforms. This showcase pins the 8.x line, where applyVite8Fixes detects the major and skips the
// function-alias and commonjs patches — upstream handles both natively there.
export default defineNativescriptConfig();
