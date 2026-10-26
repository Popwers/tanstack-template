import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card';

/**
 * Centered card framing every auth screen.
 * @param props.title - Card title.
 * @param props.description - One-line subtitle.
 * @param props.children - Form or message.
 * @returns The framed screen.
 */
export function AuthCard({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<main className='flex items-center justify-center px-4 py-24'>
			<Card className='w-full max-w-sm'>
				<CardHeader>
					<CardTitle>{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent>{children}</CardContent>
			</Card>
		</main>
	);
}
