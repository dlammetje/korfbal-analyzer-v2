import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Voeg error boundary toe
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error in component:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "20px", color: "red", fontFamily: "sans-serif" }}>
          <h1>Er is iets misgegaan</h1>
          <p>{this.state.error?.message || "Onbekende fout"}</p>
          <button onClick={() => window.location.reload()}>Vernieuw de pagina</button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Voeg StrictMode toe voor betere foutmeldingen
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Voeg een globale error handler toe
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});