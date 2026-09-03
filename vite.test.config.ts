import { defineConfig } from 'vite';

// Config for the logic smoke test (`npm test`). Bundles tests/smoke.ts with
// Vite's resolver, then Node runs the output. Kept separate so the app build
// stays untouched.
export default defineConfig({
  build: {
    outDir: '.smoke',
    emptyOutDir: true,
    lib: { entry: 'tests/smoke.ts', formats: ['es'] },
    rollupOptions: { output: { entryFileNames: 'smoke.mjs' } },
  },
});
