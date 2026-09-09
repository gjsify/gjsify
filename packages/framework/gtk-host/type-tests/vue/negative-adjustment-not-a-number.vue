<!-- expect-error: TS2322 — a bare number is NOT an adjustment (ADR 0047 § 1): it would
     be the value, and `value` is a property of its own on every widget that takes one. -->
<template>
    <AdwSpinRow :adjustment="5" />
</template>
