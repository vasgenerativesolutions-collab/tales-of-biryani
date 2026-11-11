import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import site from './site.config.js';

// ── Pages: slug → file + per-page SEO ─────────────────────
const pages = {
  '/': {
    file: 'index.html',
    title: 'Tales of Biryani | Dum Biryani Slow-Cooked in a Sealed Handi',
    description: 'Chicken dum biryani layered with aged 1121 basmati and Kashmiri saffron, sealed with dough and slow-cooked for 45 minutes in a clay handi.',
  },
  '/menu/': {
    file: 'menu/index.html',
    title: 'Menu | Tales of Biryani',
    description: 'Chicken, mutton, veg and egg dum biryani, with mirchi ka salan and double ka meetha. The Tales of Biryani menu.',
    crumb: 'Menu',
  },
  '/how-we-make-it/': {
    file: 'how-we-make-it/index.html',
    title: 'How We Make Dum Biryani | Tales of Biryani',
    description: 'Overnight marinade, par-cooked 1121 basmati, a dough-sealed handi and 45 minutes on dum: the four steps behind our biryani.',
    crumb: 'How we make it',
  },
  '/404.html': {
    file: '404.html',
    title: 'Page Not Found | Tales of Biryani',
    description: 'This page does not exist. Head back to the Tales of Biryani home page or menu.',
    noindex: true,
  },
};

const nav = [
  ['/how-we-make-it/', 'How we make it'],
  ['/menu/', 'Menu'],
];

// ── Helpers ───────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const abs = (path) => (site.url ? site.url + path : '');
const partial = (name) => readFileSync(resolve(__dirname, 'src/partials', name), 'utf8');
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

function restaurantSchema() {
  const b = site.business;
  const address = b.streetAddress && {
    '@type': 'PostalAddress',
    streetAddress: b.streetAddress,
    addressLocality: b.addressLocality || undefined,
    addressRegion: b.addressRegion || undefined,
    postalCode: b.postalCode || undefined,
    addressCountry: b.addressCountry,
  };
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: site.name,
    description: pages['/'].description,
    servesCuisine: ['Indian', 'Biryani'],
    url: abs('/') || undefined,
    logo: abs('/logo-full.png') || undefined,
    image: abs('/og-image.jpg') || undefined,
    hasMenu: abs('/menu/') || undefined,
    telephone: b.telephone || undefined,
    address: address || undefined,
    openingHours: b.openingHours.length ? b.openingHours : undefined,
  };
}

function breadcrumbSchema(page, path) {
  if (!site.url || !page.crumb) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: abs('/') },
      { '@type': 'ListItem', position: 2, name: page.crumb, item: abs(path) },
    ],
  };
}

function headTags(path) {
  const p = pages[path];
  const t = [
    "<script>document.documentElement.classList.add('js')</script>",
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    `<meta name="theme-color" content="${site.themeColor}" />`,
    p.noindex ? '<meta name="robots" content="noindex" />' : '',
    site.url && !p.noindex ? `<link rel="canonical" href="${abs(path)}" />` : '',
    '<link rel="icon" href="/favicon.ico" sizes="any" />',
    '<link rel="icon" type="image/png" href="/favicon-32.png" sizes="32x32" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    // Social share
    `<meta property="og:site_name" content="${esc(site.name)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:locale" content="${site.locale}" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(p.title)}" />`,
    `<meta name="twitter:description" content="${esc(p.description)}" />`,
  ];
  if (site.url) {
    t.push(
      `<meta property="og:url" content="${abs(path)}" />`,
      `<meta property="og:image" content="${abs('/og-image.jpg')}" />`,
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
      '<meta property="og:image:alt" content="Chicken dum biryani in a clay handi, with the Tales of Biryani logo" />',
      `<meta name="twitter:image" content="${abs('/og-image.jpg')}" />`,
    );
  }
  // Structured data
  if (path === '/') {
    t.push(ld({ '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: abs('/') || undefined }));
    t.push(ld(restaurantSchema()));
  }
  const crumbs = breadcrumbSchema(p, path);
  if (crumbs) t.push(ld(crumbs));
  if (path === '/menu/') t.push(ld(menuSchema()));
  return t.filter(Boolean).join('\n    ');
}

// Menu schema is read from the menu page itself, so the two never drift.
function menuSchema() {
  const html = readFileSync(resolve(__dirname, 'menu/index.html'), 'utf8');
  const items = [...html.matchAll(/<h2 class="dish__name">(.+?)<\/h2>[\s\S]*?data-diet="(\w+)"[\s\S]*?<p>(.+?)<\/p>/g)]
    .map(([, name, diet, description]) => ({
      '@type': 'MenuItem',
      name,
      description,
      suitableForDiet: diet === 'veg' ? 'https://schema.org/VegetarianDiet' : undefined,
    }));
  return {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: `${site.name} menu`,
    hasMenuSection: { '@type': 'MenuSection', name: 'From the handi', hasMenuItem: items },
  };
}

function header(path) {
  const links = nav
    .map(([href, label]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('\n        ');
  return partial('header.html').replace('<!--@nav-->', links);
}

function footer() {
  const b = site.business;
  const lines = [
    b.streetAddress,
    [b.addressLocality, b.postalCode].filter(Boolean).join(' '),
    b.telephone && `<a href="tel:${b.telephone.replace(/\s/g, '')}">${esc(b.telephone)}</a>`,
  ].filter(Boolean);
  const visit = lines.length
    ? `<div class="footer__col"><p class="footer__title">Visit</p>${lines.map((l) => `<p>${l}</p>`).join('')}</div>`
    : '';
  return partial('footer.html').replace('<!--@visit-->', visit).replace('<!--@tagline-->', esc(site.tagline));
}

function breadcrumbs(path) {
  const p = pages[path];
  if (!p.crumb) return '';
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">${p.crumb}</li></ol></nav>`;
}

// ── Plugin ────────────────────────────────────────────────
function seo() {
  return {
    name: 'tob-seo',
    transformIndexHtml(html, ctx) {
      const path = ctx.path === '/404.html' ? '/404.html' : ctx.path.replace(/index\.html$/, '');
      if (!pages[path]) return html;
      return html
        .replace('<!--@head-->', headTags(path))
        .replace('<!--@header-->', header(path))
        .replace('<!--@breadcrumbs-->', breadcrumbs(path))
        .replace('<!--@footer-->', footer());
    },
    generateBundle() {
      const indexable = Object.keys(pages).filter((p) => !pages[p].noindex);
      const robots = ['User-agent: *', 'Allow: /'];
      if (site.url) {
        robots.push('', `Sitemap: ${abs('/sitemap.xml')}`);
        const today = new Date().toISOString().slice(0, 10);
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable
            .map((p) => `  <url><loc>${abs(p)}</loc><lastmod>${today}</lastmod></url>`)
            .join('\n')}\n</urlset>\n`,
        });
      } else {
        this.warn('site.config.js url is empty: canonical tags, sitemap.xml and og:url/og:image were skipped.');
      }
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots.join('\n') + '\n' });
      this.emitFile({
        type: 'asset',
        fileName: 'llms.txt',
        source: [
          `# ${site.name}`,
          '',
          `> ${pages['/'].description}`,
          '',
          '## Pages',
          '',
          ...indexable.map((p) => `- [${pages[p].crumb || 'Home'}](${abs(p) || p}): ${pages[p].description}`),
          '',
        ].join('\n'),
      });
    },
  };
}

export default defineConfig({
  appType: 'mpa',
  plugins: [seo()],
  build: {
    sourcemap: false, // never ship source maps to production
    rollupOptions: {
      input: Object.fromEntries(
        Object.entries(pages).map(([path, p]) => [path === '/' ? 'home' : p.file.replace(/\/?index\.html$|\.html$/, ''), resolve(__dirname, p.file)]),
      ),
    },
  },
});
