<!-- expect-error: TS2322 — `spacing` is a number, and this is the ONE negative
     that still errors without `strictTemplates`: a gate missing that setting
     therefore looks alive while checking the wrong half. -->
<template>
    <GtkBox :spacing="'six'" />
</template>
