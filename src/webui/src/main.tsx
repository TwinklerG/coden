import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function Loading() {
  return <main>CodeN Web</main>;
}

const root = document.getElementById("root");
if (!root) throw new Error("CodeN Web root is missing");
createRoot(root).render(
  <StrictMode>
    <Loading />
  </StrictMode>,
);
