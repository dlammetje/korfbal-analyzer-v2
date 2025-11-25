import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { resetPassword } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      setMessage("");
      setError("");
      setLoading(true);
      await resetPassword(email);
      setMessage("Controleer je e-mail voor de link om je wachtwoord opnieuw in te stellen");
    } catch (err) {
      setError("Het verzenden van de wachtwoordreset is mislukt");
      console.error(err);
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="card max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            Wachtwoord vergeten
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Vul je e-mailadres in om een wachtwoordresetlink te ontvangen
          </p>
        </div>
        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-md text-sm" role="alert">
            <span className="block sm:inline">{error}</span>
          </div>
        )}
        {message ? (
          <div className="bg-emerald-500/10 border border-emerald-500 text-emerald-400 px-4 py-3 rounded-md text-sm" role="alert">
            <span className="block sm:inline">{message}</span>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="rounded-md shadow-sm space-y-4">
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
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full disabled:opacity-50"
              >
                {loading ? 'Verzenden...' : 'Stuur wachtwoordreset'}
              </button>
            </div>
          </form>
        )}
        <div className="text-sm text-center">
          <Link
            to="/login"
            className="font-medium text-brand hover:opacity-80"
          >
            Terug naar inloggen
          </Link>
        </div>
      </div>
    </div>
  );
}
