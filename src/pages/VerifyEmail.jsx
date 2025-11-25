import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function VerifyEmail() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { currentUser, sendVerificationEmail } = useAuth();
  const navigate = useNavigate();

  const handleResendEmail = async () => {
    try {
      setError("");
      setMessage("");
      setLoading(true);
      await sendVerificationEmail();
      setMessage("Verificatie-e-mail opnieuw verzonden!");
    } catch (err) {
      setError("Kan de verificatie-e-mail niet verzenden: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Controleer of e-mail al geverifieerd is
  useEffect(() => {
    if (currentUser?.emailVerified) {
      navigate("/");
    }
  }, [currentUser, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="card max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            Verifieer je e-mailadres
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            We hebben een verificatielink gestuurd naar <span className="font-medium">{currentUser?.email}</span>
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-md text-sm" role="alert">
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        {message && (
          <div className="bg-emerald-500/10 border border-emerald-500 text-emerald-400 px-4 py-3 rounded-md text-sm" role="alert">
            <span className="block sm:inline">{message}</span>
          </div>
        )}

        <div className="mt-6">
          <button
            type="button"
            onClick={handleResendEmail}
            disabled={loading}
            className="btn btn-primary w-full disabled:opacity-50"
          >
            {loading ? 'Verzenden...' : 'Verstuur verificatie-e-mail opnieuw'}
          </button>
        </div>

        <div className="mt-4 text-center text-sm">
          <button
            onClick={() => window.location.reload()}
            className="font-medium text-brand hover:opacity-80"
          >
            Ik heb mijn e-mail geverifieerd
          </button>
        </div>

        <div className="mt-6 border-t border-gray-700 pt-6">
          <p className="text-xs text-gray-400 text-center">
            Heb je de e-mail niet ontvangen? Controleer je spam-map of neem contact op met de beheerder.
          </p>
        </div>
      </div>
    </div>
  );
}
