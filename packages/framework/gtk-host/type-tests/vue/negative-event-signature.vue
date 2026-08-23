<!-- expect-error: TS2322 — `@clicked` binds the generated `onClicked` prop, which
     carries no arguments, so a handler declaring one is refused. This is the
     negative behind the positive fixture's `@clicked`: without it, "the event
     bound" and "the event bound to the RIGHT signature" are the same green. -->
<script setup lang="ts">
const withArg = (widget: string) => widget.length;
</script>

<template>
    <GtkButton @clicked="withArg" />
</template>
