import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [message, setMessage] = useState("");
  const { signup } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();

    if (password !== confirmPassword) {
      return setError("Wachtwoorden komen niet overeen");
    }

    try {
      setError("");
      setLoading(true);
      await signup(email, password, displayName);
      setVerificationSent(true);
      setMessage(`Verificatie-e-mail verzonden naar ${email}. Controleer je inbox.`);
    } catch (err) {
      setError("Registreren mislukt: " + (err.message || "Probeer het opnieuw."));
      console.error(err);
    }

    setLoading(false);
  }

  if (verificationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="card max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="text-green-400 mb-4">
              <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="mt-2 text-lg font-medium">Registratie succesvol!</p>
              <p className="mt-2 text-sm text-gray-300">{message}</p>
            </div>
            <Link
              to="/login"
              className="btn btn-primary mt-4"
            >
              Naar inloggen
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="card max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            Maak een nieuw account
          </h2>
        </div>
        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-md text-sm" role="alert">
            <span className="block sm:inline">{error}</span>
          </div>
        )}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm space-y-4">
            <div>
              <label htmlFor="display-name" className="sr-only">
                Naam
              </label>
              <input
                id="display-name"
                name="displayName"
                type="text"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-neutral-800 bg-neutral-900 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand focus:z-10 sm:text-sm"
                placeholder="Volledige naam"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="email-address" className="sr-only">
                E-mailadres
              </label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-neutral-800 bg-neutral-900 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand focus:z-10 sm:text-sm"
                placeholder="E-mailadres"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Wachtwoord
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-neutral-800 bg-neutral-900 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand focus:z-10 sm:text-sm"
                placeholder="Wachtwoord (min. 6 tekens)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="sr-only">
                Bevestig wachtwoord
              </label>
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-neutral-800 bg-neutral-900 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand focus:z-10 sm:text-sm"
                placeholder="Bevestig wachtwoord"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full disabled:opacity-50"
            >
              Account aanmaken
            </button>
          </div>
        </form>
        <div className="text-sm text-center">
          <Link
            to="/login"
            className="font-medium text-brand hover:opacity-80"
          >
            Heb je al een account? Log hier in
          </Link>
        </div>
      </div>
    </div>
  );
}
