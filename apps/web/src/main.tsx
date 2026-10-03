import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initializeEnvironment } from "./lib/environment";
import "./globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root not found");

initializeEnvironment()
  .then(() => {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    rootElement.setAttribute("role", "alert");
    rootElement.textContent =
      error instanceof Error ? error.message : "Local environment unavailable";
  });
