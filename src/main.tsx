import React from "react";
import { createRoot } from "react-dom/client";

import { QoreChainProvider } from "@qorechain/react";

import { App } from "./App.js";

// Endpoints come from Vite env vars (VITE_-prefixed), defaulting to the
// public qorechain-diana testnet endpoints. The REST API sends no CORS
// headers, so in dev the app reaches it through the /lcd Vite proxy.
const REST_URL = import.meta.env.VITE_QORE_REST_URL ?? "/lcd";
const EVM_RPC_URL =
  import.meta.env.VITE_QORE_EVM_RPC_URL ?? "https://evm-testnet.qore.host";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <React.StrictMode>
    <QoreChainProvider
      config={{
        network: "testnet",
        endpoints: { rest: REST_URL, evmRpc: EVM_RPC_URL },
      }}
    >
      <App />
    </QoreChainProvider>
  </React.StrictMode>,
);
