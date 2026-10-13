import { createRoot } from 'react-dom/client';
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import App from './App.tsx';
import './index.css';

const dynamicEnvironmentId =
  import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID || '2754a631-f95d-46e2-9b24-7f12e86d06d4';

createRoot(document.getElementById('root')!).render(
  <DynamicContextProvider
    settings={{
      environmentId: dynamicEnvironmentId,
      walletConnectors: [EthereumWalletConnectors],
    }}
  >
    <App />
  </DynamicContextProvider>
);

