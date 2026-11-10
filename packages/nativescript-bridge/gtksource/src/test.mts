// The pure entry: specs that touch neither `@nativescript/core` nor a platform global, so they
// build and run on Node and GJS with no alias. `./test.trees.mts` is the other half, for the specs
// that build the real `GtkSource.View`.

import { run } from '@gjsify/unit';

import { NativeEditorAndroidTest } from './native-editor.android.spec.js';
import { MultiTapTest } from './multi-tap.spec.js';
import { TextRangesTest } from './text-ranges.spec.js';

run({ MultiTapTest, NativeEditorAndroidTest, TextRangesTest });
