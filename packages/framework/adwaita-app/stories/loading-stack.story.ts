// Story: @gjsify/adwaita-app's LoadingStack — switch between its loading /
// content / error pages via a live SELECT control. original implementation.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { LoadingStack } from '../src/loading-stack.js';

/** Story: drive a LoadingStack through its three states from the controls panel. */
export class LoadingStackStory extends StoryWidget {
    private _stack: LoadingStack | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwaitaAppLoadingStackStory' }, LoadingStackStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(LoadingStackStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return {
            title: 'Adwaita App/LoadingStack',
            description: 'A Gtk.Stack pre-wired with loading / content / error pages, driven by loadIntoStack.',
            component: LoadingStack.$gtype,
            controls: [
                {
                    name: 'state',
                    label: 'State',
                    type: ControlType.SELECT,
                    options: [
                        { label: 'Loading', value: 'loading' },
                        { label: 'Content', value: 'content' },
                        { label: 'Error', value: 'error' },
                    ],
                    defaultValue: 'loading',
                },
                {
                    name: 'errorTitle',
                    label: 'Error title',
                    type: ControlType.TEXT,
                    defaultValue: 'Something went wrong',
                },
            ],
        };
    }

    initialize(): void {
        this._stack = new LoadingStack({ widthRequest: 360, heightRequest: 220 });
        this._stack.setContent(new Gtk.Label({ label: 'Loaded content 🎉', cssClasses: ['title-2'] }));
        this.addContent(this._stack);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._stack) return;
        this._stack.setError(this.args.errorTitle as string);
        this._stack.set_visible_child_name(this.args.state as string);
    }
}

GObject.type_ensure(LoadingStackStory.$gtype);

export const LoadingStackStories: StoryModule = { stories: [LoadingStackStory] };
