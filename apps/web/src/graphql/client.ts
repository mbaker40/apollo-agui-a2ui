import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';
import { DEV_JWT, GRAPHQL_URL } from '../config';
import { createRefetchEventManager } from '../lib/reconcile';

export const refetchEvents = createRefetchEventManager();

export const apolloClient = new ApolloClient({
  link: new HttpLink({
    uri: GRAPHQL_URL,
    headers: { authorization: `Bearer ${DEV_JWT}` },
  }),
  cache: new InMemoryCache(),
  refetchEventManager: refetchEvents,
});
