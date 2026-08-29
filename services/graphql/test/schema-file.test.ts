import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema, printSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
import { typeDefs } from '../src/server.js';

describe('schema.graphqls', () => {
  it('matches the running SDL (mobile codegen points at this file)', () => {
    const file = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.graphqls'),
      'utf8',
    );
    const fromCode = printSchema(buildSchema(typeDefs)).trimEnd() + '\n';
    // Normalize both through graphql printSchema so formatting can't drift.
    expect(printSchema(buildSchema(file))).toBe(printSchema(buildSchema(fromCode)));
    expect(file).toBe(fromCode);
  });
});
