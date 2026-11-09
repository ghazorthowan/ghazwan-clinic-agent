"use client";
import { useState } from 'react';

type Step = 'credentials' | 'mfa';

export default function LoginForm() {
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Invalid credentials');
      if (data.mfaRequired) {
        setStep('mfa');
      } else {
        location.href = '/';
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Invalid code');
      location.href = '/';
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'mfa') {
    return (
      <form onSubmit={submitMfa}>
        <label>Authenticator code</label>
        <input
          required
          type="text"
          inputMode="numeric"
          pattern="[0-9 ]{6,7}"
          autoComplete="one-time-code"
          placeholder="000000"
          value={token}
          onChange={e => setToken(e.target.value)}
        />
        <div style={{ marginTop: 14 }}>
          <button disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={submitCredentials}>
      <label>Email</label>
      <input
        required
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        autoComplete="username"
      />
      <label style={{ marginTop: 12 }}>Password</label>
      <input
        required
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      <div style={{ marginTop: 14 }}>
        <button disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
