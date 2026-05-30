const fs = require('fs');
const path = require('path');

const siteUrl = normalizeSiteUrl(process.env.SITE_URL);

const urls = [
  { url: '/', file: 'index.html' },
  { url: '/pages/h264-guide.html', file: 'pages/h264-guide.html' },
  { url: '/pages/h265-guide.html', file: 'pages/h265-guide.html' },
  { url: '/pages/h264-vs-h265.html', file: 'pages/h264-vs-h265.html' },
  { url: '/pages/annex-b-vs-mp4.html', file: 'pages/annex-b-vs-mp4.html' },
  { url: '/pages/sps-pps-vps-explained.html', file: 'pages/sps-pps-vps-explained.html' },
  { url: '/pages/examples.html', file: 'pages/examples.html' },
  { url: '/pages/faq.html', file: 'pages/faq.html' },
  { url: '/pages/about.html', file: 'pages/about.html' },
  { url: '/pages/privacy.html', file: 'pages/privacy.html' },
  { url: '/pages/terms.html', file: 'pages/terms.html' },
  { url: '/pages/contact.html', file: 'pages/contact.html' }
];

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(({ url, file }) => [
    '  <url>',
    `    <loc>${escapeXml(siteUrl + url)}</loc>`,
    `    <lastmod>${getLastmod(file)}</lastmod>`,
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

function getLastmod(filePath) {
  return fs.statSync(path.join(process.cwd(), filePath)).mtime.toISOString().slice(0, 10);
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
