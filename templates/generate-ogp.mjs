#!/usr/bin/env node
/**
 * OGP 画像生成スクリプト（ローカル実行用）
 *
 *   node templates/generate-ogp.mjs [--only <slug>]
 *
 * templates/blog_ogp_template.png を土台に、src/content/blog の各記事の
 * frontmatter（title / description / pubDate / index）を合成して
 * src/assets/<slug>.png（1200x630）を出力します。
 *
 * フォントは templates/fonts/NotoSansJP.ttf を使用します。
 * 無ければ Google Fonts リポジトリから自動ダウンロードします。
 */
import { readFileSync } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => path.resolve(ROOT, p);

const CONFIG = {
	template: 'templates/blog_ogp_template.png',
	logo: 'templates/logo.png',
	contentDir: 'src/content/blog',
	outDir: 'src/assets',
	fontFile: 'templates/fonts/NotoSansJP.ttf',
	fontUrl:
		'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf',
	// consts.ts / astro.config.mjs から読めなかった場合のフォールバック
	blogName: 'Astro Blog',
	domain: 'blog.example.com',
	author: '',
};

const LAYOUT = {
	padX: 96,
	logo: { size: 96, top: 70, left: 96, gap: 28 },
	blogName: { top: 78, size: 40 },
	domain: { top: 138, size: 26, color: '#b8b8b8' },
	title: { top: 214, size: 58, minSize: 34, width: 660, lineHeight: 1.6, spacing: 12 },
	description: { top: 400, size: 32, minSize: 24, width: 660, maxLines: 3, lineHeight: 1.6, spacing: 8, color: '#c8c8c8' },
	author: { top: 500, size: 28, color: '#b8b8b8' },
	date: { top: 540, size: 28, color: '#b8b8b8' },
};

const FONT_FAMILY = 'Noto Sans JP';

const HERO_IMAGE_LINK = (slug) => `../../assets/${slug}.png`;

/**
 * 記事 md の frontmatter の heroImage を生成画像へのリンクに更新する。
 * 未定義なら description（無ければ title）の直後に挿入する。
 */
async function updateHeroImage(filePath, slug) {
	const raw = await readFile(filePath, 'utf8');
	const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!fmMatch) return false;

	const fm = fmMatch[1];
	const link = HERO_IMAGE_LINK(slug);
	let next;
	if (/^heroImage:.*$/m.test(fm)) {
		next = fm.replace(/^heroImage:.*$/m, `heroImage: '${link}'`);
	} else {
		const anchor = fm.match(/^description:.*$/m) || fm.match(/^title:.*$/m);
		next = anchor ? fm.replace(anchor[0], `${anchor[0]}\nheroImage: '${link}'`) : `heroImage: '${link}'\n${fm}`;
	}
	if (next === fm) return false;

	await writeFile(filePath, raw.replace(fmMatch[0], `---\n${next}\n---`));
	return true;
}

function parseArgs(argv) {
	const args = { only: null };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--only') args.only = argv[++i];
	}
	return args;
}

async function exists(p) {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

async function ensureFont() {
	const fontPath = abs(CONFIG.fontFile);
	if (await exists(fontPath)) return fontPath;
	console.log(`font not found, downloading → ${CONFIG.fontFile}`);
	await mkdir(path.dirname(fontPath), { recursive: true });
	const res = await fetch(CONFIG.fontUrl);
	if (!res.ok) throw new Error(`failed to download font: ${res.status}`);
	await writeFile(fontPath, Buffer.from(await res.arrayBuffer()));
	return fontPath;
}

function readConst(name, fallback) {
	try {
		const src = readFileSyncSafe(abs('src/consts.ts'));
		// クォート種別を問わず、閉じクォートまでを取得する
		const re = new RegExp('export\\s+const\\s+' + name + "\\s*=\\s*([\"'`])([\\s\\S]*?)\\1");
		const m = src.match(re);
		return m ? m[2] : fallback;
	} catch {
		return fallback;
	}
}

function readFileSyncSafe(p) {
	return readFileSync(p, 'utf8');
}

function readSite() {
	try {
		const src = readFileSyncSafe(abs('astro.config.mjs'));
		const m = src.match(/site\s*:\s*['"`]([^'"`]+)['"`]/);
		return m ? new URL(m[1]).host : CONFIG.domain;
	} catch {
		return CONFIG.domain;
	}
}

function escapeMarkup(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseFrontmatter(raw) {
	const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!m) return {};
	const out = {};
	for (const line of m[1].split('\n')) {
		const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
		if (!kv) continue;
		let value = kv[2].trim();
		if (/^['"].*['"]$/.test(value)) value = value.slice(1, -1);
		out[kv[1]] = value;
	}
	return out;
}

// pubDate は YYYY/MM/DD 形式を前提とする
function formatDate(value) {
	const m = String(value ?? '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
	if (m) {
		const p = (n) => String(n).padStart(2, '0');
		return `${m[1]}/${p(m[2])}/${p(m[3])}`;
	}
	return String(value ?? '');
}

function renderText(text, { size, width, color = '#ffffff', weight = 'normal', spacing = 0 }) {
	const family = weight === 'bold' ? `${FONT_FAMILY} Bold` : FONT_FAMILY;
	return sharp({
		text: {
			text: `<span foreground="${color}">${escapeMarkup(text)}</span>`,
			font: `${family} ${size}`,
			fontfile: FONT_FILE,
			width,
			align: 'left',
			rgba: true,
			dpi: 72,
			spacing: Math.round(spacing),
			wrap: 'word-char',
		},
	});
}

async function measureHeight(text, opts, size) {
	const { height } = await renderText(text, { ...opts, size }).metadata();
	return height;
}

/**
 * 指定行数に収まるフォントサイズを探索し、最小サイズでも収まらない場合は
 * 末尾を省略記号で切り詰めて { size, text } を返す。
 */
async function fitText(text, opts) {
	const { maxSize, minSize, maxLines, lineHeight } = opts;
	const limit = (size) => maxLines * size * lineHeight;

	for (let size = maxSize; size >= minSize; size -= 2) {
		if ((await measureHeight(text, opts, size)) <= limit(size)) return { size, text };
	}

	const size = minSize;
	let t = text;
	while (t.length > 1) {
		if ((await measureHeight(`${t}…`, opts, size)) <= limit(size)) break;
		t = t.slice(0, -1);
	}
	return { size, text: `${t}…` };
}

let FONT_FILE;

async function buildPost(post, meta) {
	const img = sharp(abs(CONFIG.template));
	const composites = [];
	const padX = LAYOUT.padX;

	const logoPath = abs(CONFIG.logo);
	const hasLogo = await exists(logoPath);
	let textX = padX;
	if (hasLogo) {
		const logo = await sharp(logoPath)
			.resize(LAYOUT.logo.size, LAYOUT.logo.size, { fit: 'inside' })
			.png()
			.toBuffer();
		composites.push({ input: logo, top: LAYOUT.logo.top, left: LAYOUT.logo.left });
		textX = LAYOUT.logo.left + LAYOUT.logo.size + LAYOUT.logo.gap;
	}

	const blogName = (meta.blogName || '').trim();
	const domain = (meta.domain || '').trim();
	if (blogName) {
		const w = Math.min(700 - (textX - padX), 520);
		composites.push({
			input: await renderText(blogName, { size: LAYOUT.blogName.size, width: w, weight: 'bold', spacing: 4 }).png().toBuffer(),
			top: LAYOUT.blogName.top,
			left: textX,
		});
	}
	if (domain) {
		composites.push({
			input: await renderText(domain, { size: LAYOUT.domain.size, width: 520, color: LAYOUT.domain.color, spacing: 2 }).png().toBuffer(),
			top: LAYOUT.domain.top,
			left: textX,
		});
	}

	const title = post.title || '';
	if (title) {
		const fitted = await fitText(title, {
			maxSize: LAYOUT.title.size,
			minSize: LAYOUT.title.minSize,
			width: LAYOUT.title.width,
			maxLines: 2,
			lineHeight: LAYOUT.title.lineHeight,
			weight: 'bold',
			spacing: LAYOUT.title.spacing,
		});
		composites.push({
			input: await renderText(fitted.text, { size: fitted.size, width: LAYOUT.title.width, weight: 'bold', spacing: LAYOUT.title.spacing }).png().toBuffer(),
			top: LAYOUT.title.top,
			left: padX,
		});
	}

	const description = post.description || '';
	if (description) {
		const fitted = await fitText(description, {
			maxSize: LAYOUT.description.size,
			minSize: LAYOUT.description.minSize,
			width: LAYOUT.description.width,
			maxLines: LAYOUT.description.maxLines,
			lineHeight: LAYOUT.description.lineHeight,
			spacing: LAYOUT.description.spacing,
		});
		composites.push({
			input: await renderText(fitted.text, {
				size: fitted.size,
				width: LAYOUT.description.width,
				color: LAYOUT.description.color,
				spacing: LAYOUT.description.spacing,
			}).png().toBuffer(),
			top: LAYOUT.description.top,
			left: padX,
		});
	}

	if (meta.author) {
		composites.push({
			input: await renderText(`著者：${meta.author}`, { size: LAYOUT.author.size, width: 520, color: LAYOUT.author.color, spacing: 4 }).png().toBuffer(),
			top: LAYOUT.author.top,
			left: padX,
		});
	}
	composites.push({
		input: await renderText(`公開日：${formatDate(post.pubDate)}`, { size: LAYOUT.date.size, width: 520, color: LAYOUT.date.color, spacing: 4 }).png().toBuffer(),
		top: LAYOUT.date.top,
		left: padX,
	});

	const outPath = abs(path.join(CONFIG.outDir, `${post.slug}.png`));
	await mkdir(path.dirname(outPath), { recursive: true });
	await img.composite(composites).png().toFile(outPath);
	return outPath;
}

/** 記事が存在しない生成画像（<slug>.png）を src/assets から削除する */
async function pruneOrphans(validSlugs) {
	const dir = abs(CONFIG.outDir);
	const entries = await readdir(dir);
	for (const name of entries) {
		if (!name.endsWith('.png')) continue;
		if (validSlugs.has(name.slice(0, -4))) continue;
		await rm(path.join(dir, name));
		console.log(`removed orphan ${path.relative(ROOT, path.join(dir, name))}`);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	FONT_FILE = await ensureFont();

	const meta = {
		blogName: readConst('SITE_TITLE', CONFIG.blogName),
		domain: readSite(),
		author: readConst('SITE_AUTHOR', CONFIG.author),
	};

	const contentDir = abs(CONFIG.contentDir);
	const files = (await readdir(contentDir)).filter((f) => /\.(md|mdx)$/.test(f));
	const allSlugs = new Set(files.map((f) => f.replace(/\.(md|mdx)$/, '')));
	let count = 0;
	for (const file of files) {
		const slug = file.replace(/\.(md|mdx)$/, '');
		if (args.only && slug !== args.only) continue;
		const filePath = path.join(contentDir, file);
		const raw = await readFile(filePath, 'utf8');
		const post = { slug, ...parseFrontmatter(raw) };
		const out = await buildPost(post, meta);
		console.log(`generated ${path.relative(ROOT, out)}`);
		count++;

		if (await updateHeroImage(filePath, slug)) {
			console.log(`  updated frontmatter: heroImage → ${HERO_IMAGE_LINK(slug)}`);
		}
	}

	if (!args.only) await pruneOrphans(allSlugs);

	console.log(`done: ${count} image(s)`);
}

await main();
