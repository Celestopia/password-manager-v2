import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'strict-production-csp',
      transformIndexHtml(html, context) {
        if (context.server) {
          return html.replace(
            "style-src 'self'",
            "style-src 'self' 'unsafe-inline'",
          )
        }
        return html.replace(
          "connect-src 'self' ws://127.0.0.1:*",
          "connect-src 'none'",
        )
      },
    },
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
