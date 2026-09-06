'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="login-shell"><section className="login-card">
    <span className="section-kicker">Chyba serveru</span>
    <h1>Aplikaci se nepodařilo načíst</h1>
    <p>Zkontrolujte připojení k PostgreSQL a povinné proměnné prostředí. Žádná data nebyla změněna.</p>
    <button className="primary-action" onClick={reset}>Zkusit znovu</button>
  </section></main>;
}
