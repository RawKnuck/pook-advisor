"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await signIn("google", { callbackUrl });
    } catch (err) {
      console.error("Google login error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-card">
      <h2 className="login-title">Authentication Portal</h2>
      <div className="latex-divider" />

      <p className="login-description">
        Access to The Sovereign Advisor is restricted to authorized consultants.
        Please authenticate via Google to initiate session.
      </p>

      {error && (
        <div className="error-banner" style={{ marginBottom: "1.5rem" }}>
          Authentication failed: {error}. Please verify credentials.
        </div>
      )}

      <button
        onClick={handleGoogleLogin}
        disabled={loading}
        className="submit-btn login-google-btn"
      >
        {loading ? "Authenticating..." : "Login with Google"}
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="centered-layout">
      <main className="paper-container" style={{ minHeight: "auto", alignItems: "center", justifyContent: "center" }}>
        <Suspense fallback={
          <div style={{ fontStyle: "italic", textAlign: "center", padding: "2rem" }}>
            Loading authentication forms...
          </div>
        }>
          <LoginContent />
        </Suspense>
      </main>
    </div>
  );
}
