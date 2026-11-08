import React from "react";
import ReactDOM from "react-dom/client";
import { SpacetimeDBProvider } from "spacetimedb/react";
import { DbConnection } from "./module_bindings";
import App from "./App";
import "./index.css";

const uri = import.meta.env.VITE_SPACETIME_URI || "wss://maincloud.spacetimedb.com";
const database = import.meta.env.VITE_SPACETIME_DATABASE || "hackutd-535md";

const connectionBuilder = DbConnection.builder()
  .withUri(uri)
  .withDatabaseName(database);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </React.StrictMode>
);
