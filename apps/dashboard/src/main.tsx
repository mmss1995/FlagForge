import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './index.css'
import { ApiError } from './lib/api'
import { SessionProvider } from './lib/session'
import { storage } from './lib/storage'

/** A revoked or changed admin token signs the user out instead of leaving a broken screen. */
function onError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    storage.set('flagforge:session', null)
    window.location.reload()
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    // Live updates arrive over SSE, so there is no need to refetch on every focus.
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
