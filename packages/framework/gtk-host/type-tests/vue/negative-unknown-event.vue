<!-- expect-error: TS2353 needs=strictTemplates — no `onNonsuch` prop exists -->
<template>
    <GtkButton @nonsuch="() => {}" />
</template>
