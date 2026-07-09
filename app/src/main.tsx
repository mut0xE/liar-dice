import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { WalletProvider } from "./wallet/WalletProvider";
import { App } from "./App";
import "./styles/theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </React.StrictMode>
);
