/** Host resources of one e2e run; CI shards sharing a host override them. */

/** Port the app under test listens on. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3011);

/** Origin of the app under test, as e-mailed links spell it. */
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** Host port of the throwaway Postgres (`db.sh`). */
export const E2E_DB_PORT = Number(process.env.E2E_DB_PORT ?? 5439);
