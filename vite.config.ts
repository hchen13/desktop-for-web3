import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

function logDevPort() {
  return {
    name: 'log-dev-port',
    configureServer(server: any) {
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer?.address();
        const port =
          typeof addr === 'object' && addr !== null && 'port' in addr
            ? (addr as { port: number }).port
            : server.config.server.port;
        console.log(`  ➜  Local: http://localhost:${port}/`);
      });
    },
  };
}

export default defineConfig({
  plugins: [logDevPort(), solidPlugin(), crx({ manifest: manifest as any })],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/rss-proxy/blockbeats': {
        target: 'https://api.theblockbeats.news',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rss-proxy\/blockbeats/, ''),
      },
      '/rss-proxy/odaily': {
        target: 'https://rss.odaily.news',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rss-proxy\/odaily/, ''),
      },
      '/rss-proxy/cointelegraph': {
        target: 'https://cointelegraph.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rss-proxy\/cointelegraph/, ''),
      },
      '/rss-proxy/coindesk': {
        target: 'https://www.coindesk.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rss-proxy\/coindesk/, ''),
      },
      '/api-proxy/imf': {
        target: 'https://www.imf.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy\/imf/, ''),
      },
      // Binance API proxies for development
      '/binance-api': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/binance-api/, ''),
      },
      '/binance-bapi': {
        target: 'https://www.binance.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/binance-bapi/, ''),
      },
      '/binance-us-api': {
        target: 'https://api.binance.us',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/binance-us-api/, ''),
      },
      '/binance-us-bapi': {
        target: 'https://www.binance.us',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/binance-us-bapi/, ''),
      },
    },
  },
  // 使用相对路径，确保在chrome-extension://协议下正确解析
  base: './',
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
