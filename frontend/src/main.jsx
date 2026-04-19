import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./theme.css";
import "./styles/shared.css";
import "./styles/onboarding.css";
import "./styles/home.css";
import "./styles/profile.css";
import "./styles/news.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
