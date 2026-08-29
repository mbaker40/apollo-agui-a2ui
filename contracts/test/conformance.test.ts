import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';

import entityChangedSchema from '../schemas/entity_changed.schema.json';
import frontendToolsSchema from '../schemas/frontend-tools.schema.json';
import createdFixture from '../fixtures/entity-changed/created.json';
import updatedFixture from '../fixtures/entity-changed/updated.json';
import deletedFixture from '../fixtures/entity-changed/deleted.json';
import openTaskFixture from '../fixtures/frontend-tools/open-task.json';
import identityHeadersFixture from '../fixtures/identity-headers.json';
import { IDENTITY_HEADERS, OPEN_TASK_TOOL } from '../src/index.js';

const ajv = new Ajv2020({ strict: true });

describe('entity_changed schema', () => {
  const validate = ajv.compile(entityChangedSchema);

  it.each([
    ['created', createdFixture],
    ['updated', updatedFixture],
    ['deleted', deletedFixture],
  ])('fixture %s validates', (_name, fixture) => {
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects unknown kinds and missing fields', () => {
    expect(validate({ ...createdFixture, kind: 'MUTATED' })).toBe(false);
    expect(validate({ typename: 'Task', id: 'x', kind: 'CREATED' })).toBe(false);
    expect(validate({ ...createdFixture, extra: 1 })).toBe(false);
  });
});

describe('frontend tool declarations', () => {
  const validate = ajv.compile(frontendToolsSchema);

  it('open_task fixture validates against the declaration schema', () => {
    expect(validate(openTaskFixture), JSON.stringify(validate.errors)).toBe(true);
  });

  it('TS OPEN_TASK_TOOL export matches the canonical fixture exactly', () => {
    expect(OPEN_TASK_TOOL).toEqual(openTaskFixture);
  });
});

describe('identity headers', () => {
  it('TS IDENTITY_HEADERS export matches the canonical fixture exactly', () => {
    expect(IDENTITY_HEADERS).toEqual(identityHeadersFixture);
  });
});
