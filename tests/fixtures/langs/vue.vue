<template><Child @click="onClick" /></template>
<script setup lang="ts">
import Child from './Child.vue'
function onClick() { helper(1) }
const helper = (x: number) => x
</script>
