import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Studio compilé en un seul script + une feuille de style dans le plugin WordPress.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../carte-blanche/assets/studio",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: "src/main.tsx", name: "CarteBlancheStudio", formats: ["iife"], fileName: () => "studio.js" },
    rollupOptions: { output: { assetFileNames: "studio.[ext]", inlineDynamicImports: true } },
  },
});
