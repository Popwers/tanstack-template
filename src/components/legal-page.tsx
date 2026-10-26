import type { LegalDocument } from '#/content/legal/documents';

/**
 * Render a legal document.
 * @param props.document - The document to render.
 * @returns The page body.
 */
export function LegalPage({ document }: { document: LegalDocument }) {
	return (
		<main className='mx-auto max-w-2xl px-4 py-12'>
			<h1 className='text-3xl font-semibold tracking-tight'>{document.title}</h1>
			<p className='text-muted-foreground mt-2 text-sm'>Mise à jour le {document.updatedAt}</p>
			{document.sections.map((section) => (
				<section key={section.heading} className='mt-8'>
					<h2 className='text-xl font-medium'>{section.heading}</h2>
					{section.body.map((paragraph) => (
						<p key={paragraph} className='mt-3 leading-relaxed'>
							{paragraph}
						</p>
					))}
				</section>
			))}
		</main>
	);
}
