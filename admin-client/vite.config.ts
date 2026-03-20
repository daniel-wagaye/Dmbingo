import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_'],
  server: {
    allowedHosts: ['admin-client.dmzone.top'],
    port: 5174,
    open: true
  },
  build: {
    outDir: 'dist'
  }
});
