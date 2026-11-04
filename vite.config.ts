/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { configDefaults } from 'vitest/config'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rolldownOptions: {
      // Two pages: the game, and the page Google sign-in comes back to (src/net/google-callback.ts).
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        google: fileURLToPath(new URL('auth/google.html', import.meta.url)),
      },
    },
  },
  // Agent worktrees live under .claude/; their tests belong to their own checkouts.
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
})
