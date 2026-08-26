import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        suggest: resolve(import.meta.dirname, 'suggest.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      }
    }
  },
  server: { port: 5173 }
})
