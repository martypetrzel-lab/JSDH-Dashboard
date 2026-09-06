'use client';

import { useState } from 'react';
import { Siren } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: { preventDefault(): void; currentTarget: HTMLFormElement }) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
    });
    if (response.ok) {
      window.location.assign('/');
      return;
    }
    const body = await response.json().catch(() => ({ error: 'Přihlášení se nezdařilo.' }));
    setError(body.error ?? 'Přihlášení se nezdařilo.');
    setBusy(false);
  }

  return <main className="login-shell"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark login-mark"><Siren size={25} /></div>
    <span className="section-kicker">Interní systém</span>
    <h1>JSDH Nehvizdy</h1>
    <p>Přihlaste se do správy týdenní služby.</p>
    <label>Uživatelské jméno<input name="username" autoComplete="username" required /></label>
    <label>Heslo<input name="password" type="password" autoComplete="current-password" required /></label>
    {error && <div className="login-error" role="alert">{error}</div>}
    <Button className="primary-action" type="submit" disabled={busy}>{busy ? 'Ověřuji…' : 'Přihlásit se'}</Button>
  </form></main>;
}
