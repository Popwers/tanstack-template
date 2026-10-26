import { createAuthClient } from 'better-auth/react';

/**
 * Browser auth client. Never import `#/lib/auth` here: it would pull the database into the bundle.
 */
export const authClient = createAuthClient();

export const { signIn, signOut, signUp, useSession } = authClient;
