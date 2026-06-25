import { defineNativescriptConfig } from '@gjsify/nativescript-vite';

// Whole Vite config for the NativeScript build. `defineNativescriptConfig`
// composes @nativescript/vite + layers gjsify's NativeScript transforms.
//
// This showcase targets the @nativescript/vite 8.x line (Vite 8 / Rolldown /
// HMR), where gjsify's applyVite8Fixes auto-detects the major and skips the
// function-alias / commonjs patches (upstream handles them natively).
export default defineNativescriptConfig();
