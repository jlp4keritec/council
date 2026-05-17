import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En dev : proxy /api -> backend FastAPI (port 8001)
// En prod : le frontend est build et servi par Nginx, qui proxy /api vers FastAPI
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
