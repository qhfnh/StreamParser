const fs = require('fs');
const path = require('path');

const siteUrl = normalizeSiteUrl(process.env.SITE_URL);
const today = new Date().toISOString().slice(0, 10);

const urls = [
  '/',
  '/pages/h264-guide.html',
  '/pages/h265-guide.html',
  '/pages/h264-vs-h265.html',
  '/pages/annex-b-vs-mp4.html',
  '/pages/sps-pps-vps-explained.html',
  '/pages/examples.html',
  '/pages/faq.html',
  '/pages/about.html',
  '/pages/privacy.html',
  '/pages/terms.html',
  '/pages/contact.html'
];

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(url => [
    '  <url>',
    `    <loc>${escapeXml(siteUrl + url)}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    '  </url>'
  ].join('\n')),
  '</urlset>',
  ''
].join('\n');

const robots = [
  'User-agent: *',
  'Allow: /',
  '',
  `Sitemap: ${siteUrl}/sitemap.xml`,
  ''
].join('\n');

fs.writeFileSync(path.join(process.cwd(), 'sitemap.xml'), sitemap, 'utf8');
fs.writeFileSync(path.join(process.cwd(), 'robots.txt'), robots, 'utf8');

console.log(`Generated sitemap.xml and robots.txt for ${siteUrl}`);

function normalizeSiteUrl(value) {
  if (!value) {
    throw new Error('SITE_URL is required, for example: SITE_URL=https://example.com');
  }

  const trimmed = value.trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error(`SITE_URL must be a valid absolute URL: ${value}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('SITE_URL must start with http:// or https://');
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('SITE_URL should include only the scheme and host, for example: https://example.com');
  }

  return parsed.origin;
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
