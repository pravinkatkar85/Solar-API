const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_POOL_MAX = 10;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;
const DEFAULT_QUERY_TIMEOUT_MS = 10000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 10000;

function requiredText(env, name, { trim = true } = {}) {
  const raw = env[name];
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  const value = trim ? raw.trim() : raw;
  return value.length === 0 ? null : value;
}

function requiredInteger(env, name, { fallback, min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  if (!/^[0-9]+$/.test(String(raw).trim())) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function readServerConfig(env = process.env) {
  return {
    host: requiredText(env, 'HOST') ?? DEFAULT_HOST,
    port: requiredInteger(env, 'PORT', {
      fallback: DEFAULT_PORT,
      min: 1,
      max: 65535,
    }),
  };
}

export function readDatabaseConfig(env = process.env) {
  const names = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
  const missing = names.filter((name) => {
    if (name === 'PGPASSWORD') {
      return requiredText(env, name, { trim: false }) === null;
    }
    return requiredText(env, name) === null;
  });
  if (missing.length > 0) {
    throw new Error(`Missing database configuration: ${missing.join(', ')}`);
  }

  return {
    host: requiredText(env, 'PGHOST'),
    port: requiredInteger(env, 'PGPORT', { fallback: 5432, min: 1, max: 65535 }),
    database: requiredText(env, 'PGDATABASE'),
    user: requiredText(env, 'PGUSER'),
    password: requiredText(env, 'PGPASSWORD', { trim: false }),
    max: requiredInteger(env, 'PGPOOL_MAX', {
      fallback: DEFAULT_POOL_MAX,
      min: 1,
      max: 20,
    }),
    connectionTimeoutMillis: requiredInteger(env, 'PG_CONNECTION_TIMEOUT_MS', {
      fallback: DEFAULT_CONNECTION_TIMEOUT_MS,
      min: 1000,
      max: 30000,
    }),
    idleTimeoutMillis: requiredInteger(env, 'PG_IDLE_TIMEOUT_MS', {
      fallback: DEFAULT_IDLE_TIMEOUT_MS,
      min: 1000,
      max: 600000,
    }),
    query_timeout: requiredInteger(env, 'PG_QUERY_TIMEOUT_MS', {
      fallback: DEFAULT_QUERY_TIMEOUT_MS,
      min: 1000,
      max: 20000,
    }),
    statement_timeout: requiredInteger(env, 'PG_STATEMENT_TIMEOUT_MS', {
      fallback: DEFAULT_STATEMENT_TIMEOUT_MS,
      min: 1000,
      max: 20000,
    }),
    application_name: 'solar-api',
  };
}
