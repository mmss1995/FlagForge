<script setup lang="ts">
import { defaultTheme, personas, products, type Theme } from '@flagforge/example-shared/personas'
import { FlagForgeFeature, useAllFlags, useFlag, useFlagForgeClient, useFlagsStatus, useIdentify } from '@flagforge/vue'
import { ref, watchEffect } from 'vue'

const status = useFlagsStatus()
const identify = useIdentify()
const client = useFlagForgeClient()
const allFlags = useAllFlags()
const persona = ref(0)
const cart = ref(0)

const theme = useFlag<Theme>('ui-theme', defaultTheme)
const banner = useFlag('banner-message', '')
const maxItems = useFlag('max-cart-items', 10)
const maintenance = useFlag('maintenance-mode', false)

// Theme values from a flag drive CSS custom properties: a design-system token rolled out like any feature.
watchEffect(() => {
  document.documentElement.style.setProperty('--accent', theme.value.accent)
  document.documentElement.style.setProperty('--radius', `${theme.value.radius}px`)
})

function browseAs(index: number) {
  persona.value = index
  identify(personas[index]!.context)
}
</script>

<template>
  <div class="shop">
    <header class="topbar">
      <div class="brand">Forge Shop <small>Vue</small></div>
      <span class="status" :data-status="status">flags: {{ status }}</span>
    </header>

    <div class="personas" role="group" aria-label="Browse as">
      <button v-for="(p, i) in personas" :key="p.label" :aria-pressed="persona === i" @click="browseAs(i)">
        {{ p.label }}
      </button>
    </div>
    <p class="hint">{{ personas[persona]!.description }}</p>

    <div v-if="banner" class="banner">{{ banner }}</div>

    <div class="grid">
      <article v-for="product in products" :key="product.id" class="product">
        <h3>{{ product.name }}</h3>
        <p>€{{ product.price }}</p>
        <button class="btn" :disabled="cart >= maxItems" @click="cart++">Add to cart</button>
      </article>
    </div>

    <FlagForgeFeature flag="new-checkout">
      <section class="cart checkout-new">
        <div>
          <div class="tag">New one-page checkout</div>
          Cart: {{ cart }} / {{ maxItems }} items
        </div>
        <button class="btn">Pay now</button>
      </section>
      <template #fallback>
        <section class="cart">
          <span>Cart: {{ cart }} / {{ maxItems }} items</span>
          <button class="btn secondary">Step 1 of 3: shipping →</button>
        </section>
      </template>
    </FlagForgeFeature>

    <details class="debug">
      <summary>Evaluated flags</summary>
      <pre>{{ JSON.stringify({ context: client.getContext(), flags: allFlags }, null, 2) }}</pre>
    </details>

    <div v-if="maintenance" class="maintenance" role="alert">
      <div>
        <h2>We’ll be right back</h2>
        <p>The shop is in maintenance mode. Try switching the flag off in the dashboard.</p>
      </div>
    </div>
  </div>
</template>
