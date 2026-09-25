import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = process.env.FLAGFORGE_API ?? 'http://localhost:4000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same origin in development as in production, where the API serves the built dashboard.
    proxy: { '/api': api, '/sdk': api, '/health': api },
  },
})
