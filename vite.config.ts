/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

// Relative base so the same build works on GitHub Pages (/OrderBoard/),
// any other static host, and inside a Capacitor WebView later.
export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      // Same filename as the legacy hand-written worker, so installed copies
      // of the old app pick up this build as a normal service-worker update.
      filename: "sw.js",
      includeAssets: ["app-icon-192.png", "app-icon-512.png", "app-icon-maskable-192.png", "app-icon-maskable-512.png", "app-apple-touch-icon.png", "logo.svg"],
      manifest: {
        id: "./",
        name: "Order Board",
        short_name: "Order Board",
        description: "Offline order taking, billing and sales tracking for street food stalls.",
        lang: "en",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#121110",
        theme_color: "#121110",
        categories: ["business", "food", "productivity"],
        icons: [
          { src: "app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "app-icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
