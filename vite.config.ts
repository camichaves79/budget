import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the site works from any subpath,
  // e.g. https://<user>.github.io/<repo>/ on GitHub Pages.
  base: './',
  plugins: [react()],
})
