<!-- expect-error: TS2322 — `value-now` is a number slot in GTK's ARIA table -->
<template>
    <GtkLabel :accessibility="{ 'value-now': 'three' }" />
</template>
