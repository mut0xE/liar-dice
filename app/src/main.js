import { jsx as _jsx } from "react/jsx-runtime";
import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { WalletProvider } from "./wallet/WalletProvider";
import { App } from "./App";
import "./styles/theme.css";
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(WalletProvider, { children: _jsx(App, {}) }) }));
