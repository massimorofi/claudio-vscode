// Vite config for the Claudio webview (React chat + config UI).
// base: './' so the extension can load assets through webview.asWebviewUri.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'webview',
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    target: 'es2020',
  },
})
