import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { GraphQLError } from 'graphql';
import { verifyBearer, type AuthedUser } from './auth.js';
import { ExecutorClient } from './executor-client.js';

export interface GraphqlContext {
  user: AuthedUser;
  executor: ExecutorClient;
}

export const typeDefs = /* GraphQL */ `
  type Task {
    id: ID!
    title: String!
    due: String
    completed: Boolean!
  }

  type Query {
    tasks: [Task!]!
  }

  """
  Mutations exist for completeness and manual testing. The agent's chat path
  deliberately does NOT use them — backend tools call the executor's REST API
  directly; clients reconcile via AG-UI entity_changed events.
  """
  type Mutation {
    createTask(title: String!, due: String): Task!
    completeTask(id: ID!): Task!
  }
`;

export const resolvers = {
  Query: {
    tasks: (_parent: unknown, _args: unknown, ctx: GraphqlContext) => ctx.executor.tasks(ctx.user),
  },
  Mutation: {
    createTask: (
      _parent: unknown,
      args: { title: string; due?: string | null },
      ctx: GraphqlContext,
    ) => ctx.executor.createTask(ctx.user, args),
    completeTask: (_parent: unknown, args: { id: string }, ctx: GraphqlContext) =>
      ctx.executor.completeTask(ctx.user, args.id),
  },
};

export interface StartOptions {
  port: number;
  executorUrl: string;
}

export async function startGraphql(options: StartOptions) {
  const server = new ApolloServer<GraphqlContext>({ typeDefs, resolvers });
  const executor = new ExecutorClient(options.executorUrl);

  const { url } = await startStandaloneServer(server, {
    listen: { port: options.port },
    context: async ({ req }) => {
      const user = await verifyBearer(req.headers.authorization);
      if (!user) {
        throw new GraphQLError('missing or invalid bearer token', {
          extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
        });
      }
      return { user, executor };
    },
  });

  return { server, url };
}
