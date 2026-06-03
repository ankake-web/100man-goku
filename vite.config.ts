import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { attachLanServer } from './server/lanServer';

// LAN対戦の WebSocket サーバを dev サーバへ相乗りさせるプラグイン。
// apply:'serve' なので dev のみ起動（build / vitest では configureServer は呼ばれない）。
function lanWsPlugin(): Plugin {
  return {
    name: 'lan-ws',
    apply: 'serve',
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;
      const fallbackPort = server.config.server.port ?? 5173;
      attachLanServer(httpServer, fallbackPort);
    },
  };
}

export default defineConfig({
  plugins: [lanWsPlugin()],
  test: {
    environment: 'node',
  },
});
