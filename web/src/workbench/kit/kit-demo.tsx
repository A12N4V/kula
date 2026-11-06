import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KitShowcase } from "@/workbench/kit/KitShowcase";
import "@/styles.css";

/* Dev-only entry for the S1 kit showcase (/kit-demo.html). Not part of the
   app build graph beyond this module. */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KitShowcase />
  </StrictMode>,
);
