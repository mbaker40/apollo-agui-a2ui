import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildServer } from './server.js';

const port = Number(process.env.EXECUTOR_PORT ?? 7460);
const dataDir =
  process.env.EXECUTOR_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const { app } = buildServer({ dataDir, logger: true });

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`executor listening on :${port} (audit dir: ${dataDir})`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
