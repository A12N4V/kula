import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./ui";
import "./styles.css";
import { installSplitPanes } from "./ui/splitPane";
import { installTablists } from "./ui/tablist";

installSplitPanes();
installTablists();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
