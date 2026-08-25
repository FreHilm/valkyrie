import { defineConfig } from 'vite'

/**
 * The app build.
 *
 * `base: './'` so the artefact works from any path — GitHub Pages serves from
 * a repository subdirectory, and a relative base means the same build also
 * runs from a file:// URL or a different host without rebuilding.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-site',
    emptyOutDir: true,
    // The version is stamped in by the release workflow from version.txt.
    sourcemap: true,
  },
  server: { port: 5173, open: false },
  define: {
    __VALKYRIE_VERSION__: JSON.stringify(process.env.VALKYRIE_VERSION ?? 'dev'),
  },
})
