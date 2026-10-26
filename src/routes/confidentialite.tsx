import { createFileRoute } from '@tanstack/react-router';

import { LegalPage } from '#/components/legal-page';
import { CONFIDENTIALITE } from '#/content/legal/documents';

export const Route = createFileRoute('/confidentialite')({
	head: () => ({ meta: [{ title: CONFIDENTIALITE.title }] }),
	component: () => <LegalPage document={CONFIDENTIALITE} />,
});
