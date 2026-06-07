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

export default defineConfig(({ command }) => ({
  // GitHub Pages はリポジトリ名のサブパス（https://ankake-web.github.io/catan/）で配信する。
  // 本番ビルド（vite build）のときだけ base を '/catan/' にし、
  // dev サーバ（vite / npm run dev）では '/' のままにする（ローカルでは base を効かせない）。
  base: command === 'build' ? '/catan/' : '/',
  plugins: [lanWsPlugin()],
  test: {
    environment: 'node',
  },
}));
