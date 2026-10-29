/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  // Agent worktrees live under .claude/; their tests belong to their own checkouts.
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
})
