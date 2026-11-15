import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";

// The public demo is read-only: verification is plain eth_call reads against
// the public qorechain-diana EVM endpoint plus local ML-DSA-87 cryptography,
// so no wallet provider is needed here.
const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
