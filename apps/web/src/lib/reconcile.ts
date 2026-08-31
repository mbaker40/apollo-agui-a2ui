/**
 * Reconciliation: AG-UI `entity_changed` CUSTOM events → Apollo Client cache.
 *
 * The agent's backend tools write through the executor, not through GraphQL —
 * so the web app's Apollo cache learns about writes via these events, routed
 * through Apollo Client 4.2's RefetchEventManager:
 *
 * - CREATED  → invalidate the root list fields registered for the typename
 * - UPDATED  → invalidate the identified entity's fields (cache.modify + INVALIDATE)
 * - DELETED  → cache.evict + cache.gc
 *
 * `client.refetchQueries({ updateCache, onQueryUpdated })` then refetches only
 * queries whose watched data the invalidation touched, and `matchesRefetchOn`
 * respects each query's `refetchOn` opt-in — an unwatched/never-fetched query
 * triggers zero network requests (asserted by test/reconcile.test.tsx).
 */
import { RefetchEventManager } from '@apollo/client';
import type { ApolloCache } from '@apollo/client';
import type { Modifier } from '@apollo/client/cache';
import type { EntityChangedPayload } from '@mwe/contracts';

declare module '@apollo/client' {
  interface RefetchEvents {
    /** Sourceless custom event; only triggered via refetchEvents.emit(...). */
    entityChanged: EntityChangedPayload;
  }
}

/** typename → root Query list fields that must refresh when one is CREATED.
 * Growing the domain = one line here per typename (docs/SCALING.md). */
export const LIST_FIELDS_BY_TYPENAME: Record<string, readonly string[]> = {
  Task: ['tasks'],
  Tag: ['tags'],
};

const invalidateField: Modifier<unknown> = (_value, { INVALIDATE }) => INVALIDATE;

export function applyEntityChangeToCache(cache: ApolloCache, payload: EntityChangedPayload): void {
  switch (payload.kind) {
    case 'CREATED': {
      const listFields = LIST_FIELDS_BY_TYPENAME[payload.typename] ?? [];
      if (listFields.length > 0) {
        cache.modify({
          fields: Object.fromEntries(listFields.map((field) => [field, invalidateField])),
        });
      }
      break;
    }
    case 'UPDATED': {
      const id = cache.identify({ __typename: payload.typename, id: payload.id });
      if (id) {
        cache.modify({ id, fields: invalidateField });
      }
      break;
    }
    case 'DELETED': {
      const id = cache.identify({ __typename: payload.typename, id: payload.id });
      if (id) {
        cache.evict({ id });
        cache.gc();
      }
      break;
    }
  }
}

export function createRefetchEventManager(): RefetchEventManager {
  return new RefetchEventManager({
    sources: {
      // `true` = no automatic detection; the chat layer calls emit() when an
      // AG-UI CUSTOM entity_changed event arrives.
      entityChanged: true,
    },
    handlers: {
      entityChanged: ({ client, matchesRefetchOn, payload }) =>
        client.refetchQueries({
          updateCache(cache) {
            applyEntityChangeToCache(cache, payload);
          },
          onQueryUpdated(observableQuery) {
            return matchesRefetchOn(observableQuery);
          },
        }),
    },
  });
}

export function isEntityChangedPayload(value: unknown): value is EntityChangedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.typename === 'string' &&
    typeof v.id === 'string' &&
    (v.kind === 'CREATED' || v.kind === 'UPDATED' || v.kind === 'DELETED') &&
    typeof v.scope === 'string'
  );
}
