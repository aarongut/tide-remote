import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    lib: {
      entry: "web/app.js",
      formats: ["es"],
      fileName: () => "app.js",
    },
    minify: true,
  },
  fmt: {
    printWidth: 80,
    ignorePatterns: ["dist/**", "package-lock.json"],
  },
  lint: {
    ignorePatterns: ["dist/**"],
  },
});
