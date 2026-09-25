import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-192x192.png',
        'pwa-maskable-512x512.png',
      ],
      manifest: {
        name: 'Drunkify',
        short_name: 'Drunkify',
        description: 'Track drinks and trip memories with your group.',
        theme_color: '#23160e',
        background_color: '#23160e',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,woff,woff2,png,svg}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\/v1(?:\/|$)/, /^\/healthz$/, /^\/readyz$/],
        runtimeCaching: [
          // Deliberately no /api/v1 route: Workbox must never cache or replay API traffic.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/content/themes/') ||
              url.pathname.startsWith('/content/auth/'),
            handler: 'CacheFirst',
            method: 'GET',
            options: {
              cacheName: 'drunkify-content-packs',
              expiration: {
                maxEntries: 24,
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    allowedHosts: ['devpod-mumbai.uberinternal.com'],
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/healthz': { target: 'http://localhost:3000', changeOrigin: true },
      '/readyz': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
