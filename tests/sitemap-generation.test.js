const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const robotsPath = path.join(root, 'robots.txt');
const sitemapPath = path.join(root, 'sitemap.xml');
const scriptPath = path.join(root, 'scripts', 'generate-sitemap.js');

const originalRobots = fs.existsSync(robotsPath) ? fs.readFileSync(robotsPath, 'utf8') : null;
const originalSitemap = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, 'utf8') : null;

try {
  execFileSync(process.execPath, [scriptPath], {
    cwd: root,
    env: {
      ...process.env,
      SITE_URL: 'https://example.com'
    },
    stdio: 'pipe'
  });

  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const robots = fs.readFileSync(robotsPath, 'utf8');

  assert(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'sitemap should use the sitemap XML namespace');
  assert(sitemap.includes('<loc>https://example.com/</loc>'), 'sitemap should include the home page');
  assert(sitemap.includes('<loc>https://example.com/pages/h264-guide.html</loc>'), 'sitemap should include H.264 guide');
  assert(sitemap.includes('<loc>https://example.com/pages/h265-guide.html</loc>'), 'sitemap should include H.265 guide');
  assert(sitemap.includes('<lastmod>'), 'sitemap should include lastmod dates');
  assert(robots.includes('User-agent: *'), 'robots.txt should keep crawler rules');
  assert(robots.includes('Allow: /'), 'robots.txt should allow crawling');
  assert(robots.includes('Sitemap: https://example.com/sitemap.xml'), 'robots.txt should expose the generated sitemap URL');
} finally {
  if (originalRobots === null) {
    fs.rmSync(robotsPath, { force: true });
  } else {
    fs.writeFileSync(robotsPath, originalRobots, 'utf8');
  }

  if (originalSitemap === null) {
    fs.rmSync(sitemapPath, { force: true });
  } else {
    fs.writeFileSync(sitemapPath, originalSitemap, 'utf8');
  }
}

console.log('sitemap generation assertions passed');
