import { defineConfig } from 'vite';

// base: './' emits relative asset URLs so the same build works both on the
// GitHub Pages project sub-path (/Nearby-Bus-stop/) and in `vite preview`.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
