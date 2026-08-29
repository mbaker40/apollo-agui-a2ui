import { ApolloProvider } from '@apollo/client/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { apolloClient } from './graphql/client';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApolloProvider client={apolloClient}>
      <App />
    </ApolloProvider>
  </StrictMode>,
);
