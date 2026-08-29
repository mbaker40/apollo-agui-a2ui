import { gql, type TypedDocumentNode } from '@apollo/client';

export interface Tag {
  __typename: 'Tag';
  id: string;
  name: string;
}

export interface Task {
  __typename: 'Task';
  id: string;
  title: string;
  due: string | null;
  completed: boolean;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  tags: Tag[];
}

export const TASKS_QUERY: TypedDocumentNode<{ tasks: Task[] }, Record<string, never>> = gql`
  query Tasks {
    tasks {
      id
      title
      due
      completed
      priority
      tags {
        id
        name
      }
    }
  }
`;

export const TAGS_QUERY: TypedDocumentNode<{ tags: Tag[] }, Record<string, never>> = gql`
  query Tags {
    tags {
      id
      name
    }
  }
`;
