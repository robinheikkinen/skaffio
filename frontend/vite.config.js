import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Skaffio',
        short_name: 'Skaffio',
        description: 'Ditt digitala skafferi – recept, inköp & måltidsplan med lokal AI',
        theme_color: '#1E2A1A',
        background_color: '#1E2A1A',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: {
          action: '/share',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Navigations (HTML) hämtas alltid färskt om nätet finns — fallback till cache offline
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              networkTimeoutSeconds: 3,
            },
          },
          {
            // API-läsningar (bara GET): nätet först — varje lyckat svar uppdaterar cachen,
            // så offline-datan är alltid max en lyckad request gammal. Utan nät (eller >4s)
            // serveras cachen. Mutationer (POST/PUT/DELETE) matchas INTE — de går alltid
            // mot nätet och misslyckas ärligt offline. Cachen rensas vid logout (AuthContext).
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Receptbilder: filnamnet ändras aldrig för samma bild → CacheFirst.
            // purgeOnQuotaError: bilder ryker först om telefonens lagring blir full.
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'uploads-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 90, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor':  ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor':     ['lucide-react', 'react-hot-toast'],
          'fuse':          ['fuse.js'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/uploads': 'http://localhost:8000',
    },
  },
})
