import { startGraphql } from './server.js';

const port = Number(process.env.GRAPHQL_PORT ?? 7461);
const executorUrl = process.env.EXECUTOR_URL ?? 'http://localhost:7460';

startGraphql({ port, executorUrl })
  .then(({ url }) => console.log(`graphql facade listening at ${url} (executor: ${executorUrl})`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
