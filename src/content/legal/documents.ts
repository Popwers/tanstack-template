import {
	ANALYTICS_RETENTION_MONTHS,
	BACKUP_RETENTION_DAYS,
	ERROR_EVENT_RETENTION_DAYS,
	RATE_LIMIT_RETENTION_HOURS,
	SESSION_RETENTION_DAYS,
} from '#/lib/retention';

import { FILE_STORAGE, HOSTING, PROCESSORS, PUBLISHER, SITE } from './site';

/** One section of a legal page. */
export interface LegalSection {
	heading: string;
	body: string[];
}

/** A legal page. */
export interface LegalDocument {
	title: string;
	updatedAt: string;
	sections: LegalSection[];
}

export const MENTIONS_LEGALES: LegalDocument = {
	title: 'Mentions légales',
	updatedAt: '2026-10-26',
	sections: [
		{
			heading: 'Éditeur du site',
			body: [
				`Le site ${SITE.domain} est édité par ${PUBLISHER.identity}.`,
				`N° de TVA intracommunautaire : ${PUBLISHER.vatNumber}. Directeur de la publication : ${PUBLISHER.director}.`,
				`Contact : ${SITE.contactEmail}.`,
			],
		},
		{
			heading: 'Hébergement',
			body: [
				`Application et base de données hébergées par ${HOSTING}.`,
				`Fichiers stockés sur ${FILE_STORAGE}.`,
			],
		},
		{
			heading: 'Propriété intellectuelle',
			body: [
				`L’interface, les textes et le code de ${SITE.name} sont protégés. Toute reproduction sans accord est interdite.`,
			],
		},
		{
			heading: 'Données personnelles',
			body: [
				`Le détail des traitements figure dans la politique de confidentialité. Pour exercer vos droits, écrivez à ${SITE.contactEmail}.`,
			],
		},
	],
};

export const CONFIDENTIALITE: LegalDocument = {
	title: 'Politique de confidentialité',
	updatedAt: '2026-10-29',
	sections: [
		{
			heading: 'Responsable du traitement',
			body: [`${PUBLISHER.identity}. Contact : ${SITE.contactEmail}.`],
		},
		{
			heading: 'Données traitées',
			body: [
				'Compte : nom, adresse e-mail, mot de passe (stocké haché), dates de connexion. Base légale : exécution du contrat.',
				'Sécurité : adresse IP et navigateur de chaque session, compteurs anti-abus par adresse IP, vérification anti-robot Cloudflare Turnstile. Base légale : intérêt légitime.',
				'Mesure d’audience : OpenPanel, hébergé par l’éditeur, sans cookie et de façon agrégée. Base légale : intérêt légitime.',
				'Erreurs techniques : Sentry, sans adresse IP, sans contenu saisi et sans les jetons des liens reçus par e-mail. Base légale : intérêt légitime.',
			],
		},
		{
			heading: 'Destinataires et sous-traitants',
			body: PROCESSORS.map(({ purpose, provider }) => `${purpose} : ${provider}.`),
		},
		{
			heading: 'Durées de conservation',
			body: [
				'Compte : jusqu’à sa suppression, sur simple demande à l’adresse de contact.',
				`Session de connexion, avec son adresse IP et son navigateur : ${SESSION_RETENTION_DAYS} jours sans utilisation, puis effacée chaque nuit. Liens de confirmation et de réinitialisation : effacés la nuit suivant leur expiration.`,
				`Compteurs anti-abus par adresse IP : ${RATE_LIMIT_RETENTION_HOURS} heures après la dernière requête.`,
				`Sauvegardes, chiffrées au repos : ${BACKUP_RETENTION_DAYS} jours, puis effacées automatiquement.`,
				`Erreurs techniques : ${ERROR_EVENT_RETENTION_DAYS} jours. Mesure d’audience : ${ANALYTICS_RETENTION_MONTHS} mois.`,
			],
		},
		{
			heading: 'Vos droits',
			body: [
				`Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, d’opposition et de portabilité. Écrivez à ${SITE.contactEmail}. Vous pouvez aussi saisir la CNIL (www.cnil.fr).`,
			],
		},
		{
			heading: 'Cookies',
			body: [
				'Seul le cookie de session, nécessaire à la connexion, est déposé. Il n’exige pas votre accord.',
			],
		},
	],
};
