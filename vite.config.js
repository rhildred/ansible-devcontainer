import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

const sBase = "/devcontainers/";
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact()],
  server: {
    allowedHosts: true,
    hmr: {
      // Ensure HMR connects through the base
      path: sBase, 
    },

  },
  base: sBase
})
