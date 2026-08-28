// SPDX-License-Identifier: MIT
//
// `Adw.ToolbarView` as the gallery shows it: the whole widget tree — the top bar,
// the content and the bottom bar — is `toolbar-view.blp`, and nothing is left for
// the TypeScript to do but name the class.
//
// `Adw.Bin` for the same measured reason as the header bar: AdwToolbarView is a
// final type and cannot be a template's class.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';

import Template from './toolbar-view.blp';

export class GalleryToolbarView extends Adw.Bin {
    static {
        GObject.registerClass({ GTypeName: 'GalleryToolbarView', Template }, this);
    }
}
