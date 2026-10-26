import { Link } from '@tanstack/react-router';

import { PUBLISHER, SITE } from '#/content/legal/site';

/** Footer with the legal links every public page needs. */
export function SiteFooter() {
	return (
		<footer className='text-muted-foreground border-t px-4 py-6 text-sm'>
			<div className='mx-auto flex max-w-5xl flex-wrap gap-4'>
				<span>
					© {SITE.name} — {PUBLISHER.name}
				</span>
				<Link to='/mentions-legales' className='hover:underline'>
					Mentions légales
				</Link>
				<Link to='/confidentialite' className='hover:underline'>
					Confidentialité
				</Link>
			</div>
		</footer>
	);
}
