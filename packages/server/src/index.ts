import { loadConfig } from './config'
import { createServer } from './createServer'

const config = loadConfig()
const server = await createServer(config)
const http = server.app.listen(config.PORT, () => {
  console.log(`[flagforge] listening on http://localhost:${config.PORT} (environments: ${config.ENVIRONMENTS.join(', ')})`)
})

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[flagforge] ${signal} received, shutting down`)
  // Ending the streams first lets SDKs reconnect to another instance straight away.
  await server.close()
  http.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
