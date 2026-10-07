import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["logo.jpg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Play dos Amigos",
        short_name: "Play dos Amigos",
        description: "Cadastro, sorteio de chaves, classificação e mata-mata do seu torneio de beach tennis.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#F2F5F9",
        theme_color: "#123E72",
        orientation: "portrait-primary",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Cacheia o "shell" do app (HTML/JS/CSS/imagens) para abrir rápido e
        // funcionar offline para quem já visitou — os dados do torneio em si
        // continuam vindo do Supabase e precisam de internet para salvar.
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,ico}"],
      },
    }),
  ],
});
