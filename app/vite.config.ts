import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Liar's Dice",
        short_name: "LiarDice",
        display: "standalone",
        background_color: "#0b0b0f",
        theme_color: "#0b0b0f",
        icons: [],
      },
    }),
  ],
});
