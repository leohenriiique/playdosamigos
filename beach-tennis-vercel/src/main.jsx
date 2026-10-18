import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, fontFamily: "sans-serif" }}>
          <h2>Algo deu errado ao abrir o app</h2>
          <p>Recarregue a página (Ctrl+Shift+R). Se continuar, envie esta mensagem:</p>
          <pre style={{ whiteSpace: "pre-wrap", background: "#eee", padding: 12 }}>{String(this.state.err?.stack || this.state.err)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
