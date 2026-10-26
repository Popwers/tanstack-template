import { createFileRoute } from '@tanstack/react-router';

import { LegalPage } from '#/components/legal-page';
import { MENTIONS_LEGALES } from '#/content/legal/documents';

export const Route = createFileRoute('/mentions-legales')({
	head: () => ({ meta: [{ title: MENTIONS_LEGALES.title }] }),
	component: () => <LegalPage document={MENTIONS_LEGALES} />,
});
