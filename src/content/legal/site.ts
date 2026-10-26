/**
 * Legal identity of the product. Every legal page reads it from here: set `SITE` when you start a
 * project, keep `PUBLISHER` and `HOSTING` unless the company or the host changes.
 * `make conformity` fails when `HOSTING` is empty.
 */

/** The product itself. */
export const SITE = {
	name: 'Mon produit',
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
