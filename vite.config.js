import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    // Target modern browsers — allows tighter output (no legacy polyfills)
    target: 'es2020',

    // Minify CSS (already default; explicit for clarity)
    cssMinify: true,

    // BabylonJS tree-shaken chunk is large; raise the warning threshold
    chunkSizeWarningLimit: 1500,

    rollupOptions: {
      // ── Entry points ────────────────────────────────────────────────────────
      input: {
        main:            'index.html',
        joystick:        'joystick.html',
        display:         'display.html',
        firstpersonview: 'firstpersonview.html',
      },

      output: {
        // ── Manual chunks ──────────────────────────────────────────────────
        // Splits dependencies into stable named chunks so browsers can cache
        // them independently across navigations between pages.
        manualChunks(id) {
          // BabylonJS — large, tree-shaken, shared by display + firstpersonview
          if (id.includes('@babylonjs')) return 'vendor-babylon'

          // Socket.IO client (and its engine.io/parser deps)
          if (id.includes('socket.io') || id.includes('engine.io')) return 'vendor-socket'

          // nipplejs — only used on the joystick page
          if (id.includes('nipplejs')) return 'vendor-nipple'

          // Shared 3D helpers — WorldRenderer + VehicleManager + worldConstants
          // used by both display.html and firstpersonview.html
          if (
            id.includes('WorldRenderer') ||
            id.includes('VehicleManager') ||
            id.includes('worldConstants')
          ) return 'shared-3d'

          // Shared joystick helpers — InputController, FireController, Minimap
          if (
            id.includes('InputController') ||
            id.includes('FireController') ||
            id.includes('Minimap')
          ) return 'shared-joystick'
        },
      },
    },
  },

  server: {
    proxy: {
      '/socket.io': {
        target:       'http://localhost:3000',
        ws:           true,
        changeOrigin: true,
      },
    },
  },
})
