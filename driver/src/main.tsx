import React from "react";
import ReactDOM from "react-dom/client";
import { SpacetimeDBProvider } from "spacetimedb/react";
import { DbConnection } from "./module_bindings";
import App from "./App";
import "./index.css";
import { SPACETIME_DEMO_DATABASE, SPACETIME_URI } from "../../shared/spacetime";

const uri = import.meta.env.VITE_SPACETIME_URI || SPACETIME_URI;
const database = import.meta.env.VITE_SPACETIME_DATABASE || SPACETIME_DEMO_DATABASE;

const tokenKey = `spacetime-driver:${uri}:${database}`;

const connectionBuilder = DbConnection.builder()
  .withUri(uri)
  .withDatabaseName(database)
  .withToken(localStorage.getItem(tokenKey) ?? undefined)
  .onConnect((_connection, _identity, token) => {
    localStorage.setItem(tokenKey, token);
  });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </React.StrictMode>
);
