<script>
  import { onMount } from 'svelte';
  function greet() { return helper('x'); }
  function helper(s) { return s; }
  onMount(greet);
</script>
<h1>{greet()}</h1>
