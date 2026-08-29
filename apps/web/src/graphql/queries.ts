import { gql, type TypedDocumentNode } from '@apollo/client';

export interface Task {
  __typename: 'Task';
  id: string;
  title: string;
  due: string | null;
  completed: boolean;
}

export const TASKS_QUERY: TypedDocumentNode<{ tasks: Task[] }, Record<string, never>> = gql`
  query Tasks {
    tasks {
      id
      title
      due
      completed
    }
  }
`;
