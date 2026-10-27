import { FILE_STORAGE, HOSTING, PUBLISHER, SITE } from './site';

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
	updatedAt: '2026-10-27',
	sections: [
		{
			heading: 'Responsable du traitement',
			body: [`${PUBLISHER.identity}. Contact : ${SITE.contactEmail}.`],
		},
		{
			heading: 'Données traitées',
			body: [
				'Compte : nom, adresse e-mail, mot de passe (stocké haché), dates de connexion. Base légale : exécution du contrat.',
				'Sécurité : adresse IP et navigateur de chaque session, vérification anti-robot Cloudflare Turnstile. Base légale : intérêt légitime.',
				'Mesure d’audience : OpenPanel, hébergé par l’éditeur, sans cookie et de façon agrégée. Base légale : intérêt légitime.',
				'Erreurs techniques : Sentry, sans adresse IP ni contenu saisi. Base légale : intérêt légitime.',
			],
		},
		{
			heading: 'Destinataires et sous-traitants',
			body: [
				`Hébergement : ${HOSTING}.`,
				`Stockage des fichiers : ${FILE_STORAGE}.`,
				'Envoi des e-mails : Resend, Inc. (États-Unis), encadré par les clauses contractuelles types.',
				'Vérification anti-robot : Cloudflare, Inc. (États-Unis), encadré par les clauses contractuelles types.',
				'Suivi des erreurs : Functional Software, Inc. (Sentry, États-Unis), encadré par les clauses contractuelles types.',
			],
		},
		{
			heading: 'Durées de conservation',
			body: [
				'Les données du compte sont conservées tant que le compte est actif, puis supprimées. Les sauvegardes, chiffrées au repos, sont conservées 3 jours puis effacées automatiquement.',
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
