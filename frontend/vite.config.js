import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Version unique source de verite : frontend/package.json -> __APP_VERSION__
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// En dev : proxy /api -> backend FastAPI (port 8001)
// En prod : le frontend est build et servi par Nginx, qui proxy /api vers FastAPI
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5180,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
    // Autorise l'import ?raw du CHANGELOG.md situe a la racine (un niveau au-dessus de frontend/)
    fs: {
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
