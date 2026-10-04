// Browser port of the Editable Label story. Shares metadata with editable-label.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { editableLabelMeta } from '../../text/editable-label.meta.js';

/** The properties the story drives, as `<gtk-editable-label>` spells them. */
interface EditableLabelControls {
    text: string;
    editable: boolean;
    editing: boolean;
}

export class EditableLabelWebStory extends StoryElement {
    private _label: (HTMLElement & EditableLabelControls) | null = null;

    constructor() {
        super(EditableLabelWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return editableLabelMeta;
    }

    initialize(): void {
        this._label = document.createElement('gtk-editable-label') as HTMLElement & EditableLabelControls;
        this._label.text = this.args.text as string;
        this._apply();
        this.addContent(this._label);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._label) return;
        // The draft lives in the entry, so `text` is written only while nothing is being
        // edited — the order the C keeps them in (gtkeditablelabel.c:237-248).
        if (!this._label.editing) this._label.text = this.args.text as string;
        this._label.editable = this.args.editable as boolean;
        this._label.editing = this.args.editing as boolean;
    }
}

export const EditableLabelWebStories: WebStoryModule = { stories: [EditableLabelWebStory] };
