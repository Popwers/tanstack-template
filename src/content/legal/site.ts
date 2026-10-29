/**
 * Legal identity of the product. Every legal page reads it from here: set `SITE` when you start a
 * project, keep `PUBLISHER` and `HOSTING` unless the company or the host changes, and replace every
 * `[bracketed]` placeholder of `PROCESSORS`. `stack-conformity` fails when `HOSTING` is empty.
 */

/** The product itself. */
export const SITE = {
	name: 'Mon produit',
	/** Meta description and share text (og:description). */
	description: 'TanStack Start, Postgres, Better Auth, R2, Sentry et OpenPanel, prêts pour Coolify.',
	domain: 'example.com',
	contactEmail: 'bonjour@example.com',
} as const;

/** The company that publishes the site. */
export const PUBLISHER = {
	name: 'MYSTUDIO.DIGITAL',
	identity:
		'MYSTUDIO.DIGITAL, société par actions simplifiée (SAS) au capital de 100 euros, immatriculée au RCS de Saint-Pierre de La Réunion sous le numéro 937 947 174 (SIRET 937 947 174 00036), dont le siège social est situé 67 A Chemin de l’École du Bois de Nèfles, 97426 Les Trois-Bassins, La Réunion',
	vatNumber: 'FR59937947174',
	director: 'Lionel Bataille, président',
} as const;

/** Hosting provider of the application and its database. */
export const HOSTING =
	'Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Allemagne (+49 9831 505-0)';

/** Object storage provider (R2 buckets in the EU jurisdiction). */
export const FILE_STORAGE =
	'Cloudflare R2, service de Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis (données stockées dans l’Union européenne)';

/** One sub-processor of the privacy policy: what it does, who it is, where the data goes. */
export interface Processor {
	purpose: string;
	provider: string;
}

/** Transfers to the United States rest on the standard contractual clauses. */
const US_TRANSFER = 'États-Unis, encadré par les clauses contractuelles types';

/**
 * Every sub-processor, as the standard lists them: hosting, CDN/WAF, storage, e-mail sending and the
 * contact mailbox host, captcha, error tracking, analytics, payment. Replace the `[bracketed]`
 * placeholders; delete the payment line when the product sells nothing, and add every third-party API
 * the code calls with user data.
 */
export const PROCESSORS: readonly Processor[] = [
	{ purpose: 'Hébergement de l’application et de la base de données', provider: HOSTING },
	{
		purpose: 'Réseau de diffusion (CDN) et pare-feu applicatif',
		provider: `Cloudflare, Inc. (${US_TRANSFER})`,
	},
	{ purpose: 'Stockage des fichiers et des sauvegardes', provider: FILE_STORAGE },
	{ purpose: 'Envoi des e-mails', provider: `Resend, Inc. (${US_TRANSFER})` },
	{
		purpose: 'Boîte de réception de l’adresse de contact',
		provider: '[Hébergeur de la boîte de contact, par exemple o2switch (France) ou Google Workspace]',
	},
	{
		purpose: 'Vérification anti-robot',
		provider: `Cloudflare Turnstile, Cloudflare, Inc. (${US_TRANSFER})`,
	},
	{ purpose: 'Suivi des erreurs', provider: `Functional Software, Inc. (Sentry, ${US_TRANSFER})` },
	{ purpose: 'Mesure d’audience', provider: `OpenPanel, auto-hébergé par l’éditeur chez ${HOSTING}` },
	{
		purpose: 'Paiement',
		provider: '[Stripe Payments Europe, Ltd. (Irlande) — à retirer si le produit ne vend rien]',
	},
];
