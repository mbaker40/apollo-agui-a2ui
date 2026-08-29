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
  enum Priority {
    LOW
    MEDIUM
    HIGH
  }

  type Tag {
    id: ID!
    name: String!
  }

  type Task {
    id: ID!
    title: String!
    due: String
    completed: Boolean!
    priority: Priority!
    tags: [Tag!]!
  }

  type ResetResult {
    deletedTaskIds: [ID!]!
    deletedTagIds: [ID!]!
  }

  type Query {
    tasks: [Task!]!
    tags: [Tag!]!
  }

  """
  Mutations exist for completeness and manual testing. The agent's chat path
  deliberately does NOT use them — backend tools call the executor's REST API
  directly; clients reconcile via AG-UI entity_changed events.
  """
  type Mutation {
    createTask(title: String!, due: String): Task!
    completeTask(id: ID!): Task!
    renameTask(id: ID!, title: String!): Task!
    setDue(id: ID!, due: String): Task!
    setPriority(id: ID!, priority: Priority!): Task!
    reopenTask(id: ID!): Task!
    "Returns the deleted task."
    deleteTask(id: ID!): Task!
    duplicateTask(id: ID!): Task!
    "Returns the tasks that were removed."
    clearCompleted: [Task!]!
    createTag(name: String!): Tag!
    "Attaches a tag by name, creating it if needed; returns the updated task."
    tagTask(id: ID!, name: String!): Task!
    resetDemo: ResetResult!
  }
`;

export const resolvers = {
  Query: {
    tasks: (_parent: unknown, _args: unknown, ctx: GraphqlContext) => ctx.executor.tasks(ctx.user),
    tags: (_parent: unknown, _args: unknown, ctx: GraphqlContext) => ctx.executor.tags(ctx.user),
  },
  Mutation: {
    createTask: (
      _parent: unknown,
      args: { title: string; due?: string | null },
      ctx: GraphqlContext,
    ) => ctx.executor.createTask(ctx.user, args),
    completeTask: (_parent: unknown, args: { id: string }, ctx: GraphqlContext) =>
      ctx.executor.completeTask(ctx.user, args.id),
    renameTask: (_parent: unknown, args: { id: string; title: string }, ctx: GraphqlContext) =>
      ctx.executor.renameTask(ctx.user, args.id, args.title),
    setDue: (_parent: unknown, args: { id: string; due?: string | null }, ctx: GraphqlContext) =>
      ctx.executor.setDue(ctx.user, args.id, args.due ?? null),
    setPriority: (_parent: unknown, args: { id: string; priority: string }, ctx: GraphqlContext) =>
      ctx.executor.setPriority(ctx.user, args.id, args.priority),
    reopenTask: (_parent: unknown, args: { id: string }, ctx: GraphqlContext) =>
      ctx.executor.reopenTask(ctx.user, args.id),
    deleteTask: (_parent: unknown, args: { id: string }, ctx: GraphqlContext) =>
      ctx.executor.deleteTask(ctx.user, args.id),
    duplicateTask: (_parent: unknown, args: { id: string }, ctx: GraphqlContext) =>
      ctx.executor.duplicateTask(ctx.user, args.id),
    clearCompleted: async (_parent: unknown, _args: unknown, ctx: GraphqlContext) =>
      (await ctx.executor.clearCompleted(ctx.user)).deleted,
    createTag: (_parent: unknown, args: { name: string }, ctx: GraphqlContext) =>
      ctx.executor.createTag(ctx.user, args.name),
    tagTask: async (_parent: unknown, args: { id: string; name: string }, ctx: GraphqlContext) =>
      (await ctx.executor.tagTask(ctx.user, args.id, args.name)).task,
    resetDemo: (_parent: unknown, _args: unknown, ctx: GraphqlContext) =>
      ctx.executor.resetDemo(ctx.user),
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
