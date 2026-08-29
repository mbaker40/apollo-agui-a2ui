/**
 * Regenerates the canonical schema.graphqls from the facade's typeDefs.
 * The mobile shells' codegen points at that file; test/schema-file.test.ts
 * fails if it drifts from the running SDL. Run: pnpm --filter @mwe/graphql print-schema
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema, printSchema } from 'graphql';
import { typeDefs } from '../src/server.js';

const sdl = printSchema(buildSchema(typeDefs)).trimEnd() + '\n';
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.graphqls');
writeFileSync(target, sdl, 'utf8');
console.log(`wrote ${target}`);
