import React from 'react';
import ReactDOM from 'react-dom/client';
import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiClient } from '@mysten/sui/client';
import '@mysten/dapp-kit/dist/index.css';
import App from './App';

const queryClient = new QueryClient();

const networks = {
  testnet: { url: 'https://fullnode.testnet.sui.io:443' }
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <QueryClientProvider client={queryClient}>
    <SuiClientProvider
      networks={networks}
      defaultNetwork="testnet"
      createClient={(network, config) => new SuiClient({ url: config.url })}
    >
      <WalletProvider>
        <App />
      </WalletProvider>
    </SuiClientProvider>
  </QueryClientProvider>
);