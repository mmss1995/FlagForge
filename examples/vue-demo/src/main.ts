import '@flagforge/example-shared/shop.css'
import { config, personas } from '@flagforge/example-shared/personas'
import { createClient } from '@flagforge/js'
import { createFlagForge } from '@flagforge/vue'
import { createApp } from 'vue'
import Shop from './Shop.vue'

const client = createClient({ ...config, context: personas[0]!.context })

createApp(Shop).use(createFlagForge(client)).mount('#app')
