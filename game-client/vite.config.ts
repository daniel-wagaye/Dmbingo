import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_'],
  server: {
    allowedHosts: ['game-client.dmzone.top', 'game-server.dmzone.top'],
    
    port: 5175,
    open: false
  },
  build: {
    outDir: 'dist'
  }
});
