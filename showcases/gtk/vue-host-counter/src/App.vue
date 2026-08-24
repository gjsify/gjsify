<!-- SPDX-License-Identifier: MIT

     The counter window's CONTENT, as one Vue single-file component, compiled by
     `@gjsify/rolldown-plugin-vue`.

     WHY THE CONTENT AND NOT THE WINDOW, unlike its two siblings: Vue mounts INTO a
     container, and a toplevel window is not a child of anything — `app.mount(box)`
     with an `adw-application-window` root would ask GTK to parent a toplevel and
     earn a `Gtk-WARNING` at exit 0. So the application owns the window (it also
     owns the `Adw.Application` the window needs) and Vue owns everything inside it,
     which is the shape `mount(rootComponent, container)` documents.

     Both tag spellings appear on purpose. Volar answers `<GtkLabel>` and
     `<gtk-label>` from ONE `GlobalComponents` key, and `isCustomElement` is asked
     about both — a kebab-only predicate leaves the Pascal spelling compiling to
     `resolveComponent`, which type-checks and then resolves to nothing. -->
<script setup lang="ts">
import { ref } from '@vue/runtime-core';

interface Row {
    readonly id: number;
    readonly title: string;
}

const count = ref(0);
const rows = ref<readonly Row[]>([]);
let nextRow = 1;

const increment = () => {
    count.value += 1;
};

const addRow = () => {
    rows.value = [...rows.value, { id: nextRow, title: `Row ${nextRow}` }];
    nextRow += 1;
};

const removeFirstRow = () => {
    rows.value = rows.value.slice(1);
};
</script>

<template>
    <adw-toolbar-view>
        <adw-header-bar slot="top">
            <GtkLabel label="Built by a .vue SFC" slot="title" />
        </adw-header-bar>
        <adw-preferences-page slot="content">
            <adw-preferences-group title="Rows">
                <!-- Rendered BEFORE the counter row on purpose: Adw.PreferencesGroup
                     has no `insert()`, so the placement policy degrades to
                     `remove-all` and the host replays the tail. Vue's anchored
                     insertion is what makes that path run at all. -->
                <adw-action-row
                    v-for="row in rows"
                    :key="row.id"
                    :title="row.title"
                    subtitle="added at runtime"
                />
                <!-- `css-name` is CONSTRUCT-ONLY on every GtkWidget. Vue's
                     `createElement` op receives the vnode props, so it arrives in
                     time and no rebuild is needed — the opposite of the Solid path,
                     where the compiler sets every property after construction. -->
                <adw-action-row title="Clicks" :subtitle="String(count)" css-name="row" />
            </adw-preferences-group>
            <adw-preferences-group title="Actions">
                <!-- `orientation="vertical"` as a STRING is the case GObject drops
                     silently; the host resolves the nick against GtkOrientation. -->
                <gtk-box orientation="vertical" :spacing="12" :margin-top="12">
                    <gtk-button label="Increment" halign="center" @clicked="increment" />
                    <!-- A `v-if` in the MIDDLE, so the probe can prove the anchor
                         Vue marks the empty branch with never enters the GTK tree.
                         If it did, "Add row" would sit one index further down while
                         the branch is closed and GTK would say nothing about it. -->
                    <gtk-label v-if="count > 0" :label="`clicked ${count}x`" />
                    <gtk-button label="Add row" halign="center" @clicked="addRow" />
                    <gtk-button label="Remove first row" halign="center" @clicked="removeFirstRow" />
                </gtk-box>
            </adw-preferences-group>
        </adw-preferences-page>
    </adw-toolbar-view>
</template>
