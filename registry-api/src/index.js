import { loadConfig } from './config.js';
import { Registry } from './registry.js';
import { createApp } from './http.js';

const cfg = loadConfig();
const registry = new Registry(cfg);
const server = createApp(registry, cfg);

server.listen(cfg.port, cfg.host, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'registry listening', port: cfg.port, azuracast: cfg.azuracastInternalUrl || null }));
});
// Start polling after the server is up so /health answers immediately.
registry.start();

const shutdown = () => {
  registry.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
