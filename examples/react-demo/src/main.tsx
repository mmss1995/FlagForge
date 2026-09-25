import '@flagforge/example-shared/shop.css'
import { config, personas } from '@flagforge/example-shared/personas'
import { createClient } from '@flagforge/js'
import { FlagForgeProvider } from '@flagforge/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Shop } from './Shop'

// One client for the whole app, created outside React so StrictMode does not open two streams.
const client = createClient({ ...config, context: personas[0]!.context })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FlagForgeProvider client={client}>
      <Shop />
    </FlagForgeProvider>
  </StrictMode>,
)
