const REQUIRED_ENV = ['DATABASE_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'INTEGRATION_API_KEY', 'TZ'] as const;

export type RuntimeEnv = Record<(typeof REQUIRED_ENV)[number], string>;

export function getRuntimeEnv(): RuntimeEnv {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error(`Chybí povinné proměnné prostředí: ${missing.join(', ')}`);
  }

  const values = Object.fromEntries(REQUIRED_ENV.map((name) => [name, process.env[name]!])) as RuntimeEnv;
  if (values.TZ !== 'Europe/Prague') throw new Error('TZ musí být nastaveno na Europe/Prague.');
  if (values.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET musí mít alespoň 32 znaků.');
  return values;
}

export function configurationError(error: unknown) {
  return error instanceof Error && error.message.startsWith('Chybí povinné proměnné prostředí:')
    ? error.message
    : error instanceof Error
      ? error.message
      : 'Server není správně nakonfigurován.';
}
