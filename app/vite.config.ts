import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { nearDemoPlugin } from '../near-demo/api.js';
export default defineConfig(({ mode }) => {
  const root = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), 'PUMPCOIN_');
  const app = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'PUMPCOIN_');
  const key = app.PUMPCOIN_ONECLICK_API_KEY || root.PUMPCOIN_ONECLICK_API_KEY;
  if (key) process.env.PUMPCOIN_ONECLICK_API_KEY = key;
  return { plugins: [react(), tailwindcss(), nearDemoPlugin()], server: {host:'127.0.0.1',port:5197,strictPort:true}, preview: {host:'127.0.0.1',port:5198,strictPort:true} };
});
