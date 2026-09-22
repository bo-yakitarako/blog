// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://blog.bo-yakitarako.dev',
	integrations: [mdx(), sitemap()],
	fonts: [
		{
			provider: fontProviders.google(),
			name: 'Noto Sans JP',
			cssVariable: '--font-noto-sans-jp',
			fallbacks: ['sans-serif'],
			optimizedFallbacks: false,
			weights: ['400', '700'],
			styles: ['normal'],
		},
	],
	server: {
		allowedHosts: ['astro.bo-yakitarako.dev'],
	},
});
