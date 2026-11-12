import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/cascadia-code/latin-400.css";
import { VariantsApp } from "./VariantsApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VariantsApp />
  </React.StrictMode>,
);
