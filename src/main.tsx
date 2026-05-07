import { createRoot } from "react-dom/client";
import App from "./client/App.tsx";
import "./style.css";

createRoot(document.querySelector<HTMLDivElement>("#app")!).render(<App />);
