<!-- The Vue surface in its working spellings.
     Both tag spellings ONE `GlobalComponents` key answers (`GtkBox` and
     `gtk-box` — Volar camelizes and capitalises a template tag before it looks
     the component up), a camelCase prop, a kebab prop, an enum nick, and an
     event bound through the `on<Signal>` prop Volar derives `@signal` from. -->
<script setup lang="ts">
const activated = () => {};
</script>

<template>
    <GtkBox orientation="vertical" :spacing="6">
        <gtk-label label="a label" ellipsize="end" />
        <GtkButton icon-name="list-add-symbolic" @clicked="activated" />
        <gtk-box :baseline-child="0" />
    </GtkBox>
</template>
