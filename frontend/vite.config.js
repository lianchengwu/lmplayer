import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: true,
    rollupOptions: {
      input: 'index.html'
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true
  },
  base: './',
  publicDir: 'public',
  resolve: {
    alias: {
      '@wailsio/runtime': path.resolve(dir, 'wails-runtime.js')
    }
  },
  clearScreen: false
})
