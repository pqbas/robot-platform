import { readFileSync } from "fs"
import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

function getBackendPort(): string {
  const envFile = process.env.ENV_FILE || ".env.robot"
  const rootDir = path.resolve(__dirname, "..")
  try {
    const content = readFileSync(path.resolve(rootDir, envFile), "utf-8")
    const match = content.match(/^PORT=(\d+)/m)
    if (match) return match[1]
  } catch {}
  return "8080"
}

const backendPort = getBackendPort()
const backendUrl = `http://localhost:${backendPort}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    proxy: {
      "/offer": backendUrl,
      "/toggle_processing": backendUrl,
      "/api": backendUrl,
      "/ws": { target: backendUrl, ws: true },
    },
  },
})
