const assert = require('assert');
const fs = require('fs');
const path = require('path');

const requiredPages = [
  'pages/h264-guide.html',
  'pages/h265-guide.html',
  'pages/h264-vs-h265.html',
  'pages/annex-b-vs-mp4.html',
  'pages/sps-pps-vps-explained.html',
  'pages/examples.html',
  'pages/faq.html',
  'pages/about.html',
  'pages/privacy.html',
  'pages/terms.html',
  'pages/contact.html'
];

for (const page of requiredPages) {
  assert(fs.existsSync(page), `${page} should exist`);
  const html = fs.readFileSync(page, 'utf8');
  assert(html.includes('<meta name="description"'), `${page} should have a meta description`);
  assert(html.includes('class="top-bar"'), `${page} should have a separate top navigation bar`);
  assert(html.includes('portal-main-nav'), `${page} should have portal top navigation`);
  assert(html.includes('class="sub-nav-bar"'), `${page} should have a secondary navigation bar`);
  assert(html.includes('class="sub-nav"'), `${page} should have secondary navigation links`);
  assert(html.includes('id="language-switch"'), `${page} should expose the language switch`);
  assert(html.includes('data-lang="en"'), `${page} should provide an English language option`);
  assert(html.includes('../assets/style.css'), `${page} should load CSS from assets/`);
  assert(html.includes('../assets/site-i18n.js'), `${page} should load static page localization from assets/`);
  assert(!html.includes('class="portal-menu"'), `${page} should not keep the removed common-entry menu`);
  assert(!html.includes('portal-tool-grid'), `${page} should not keep common entry links`);
  assert(!html.includes('site-nav.js'), `${page} should not load the removed common-entry highlighter`);
  assert(!html.includes('portal-categories'), `${page} should not keep the removed left category navigation`);
  assert(html.indexOf('class="top-bar"') < html.indexOf('<header class="site-header"'), `${page} should place navigation above the page header`);
  assert(html.includes('class="footer-links"'), `${page} should have footer links`);
  assert(html.includes('../index.html'), `${page} should link back to the parser`);
}

const index = fs.readFileSync('index.html', 'utf8');
assert(index.includes('class="top-bar"'), 'home page should have a separate top navigation bar');
assert(index.includes('portal-main-nav'), 'home page should have portal top navigation');
assert(index.includes('class="sub-nav-bar"'), 'home page should have a secondary navigation bar');
assert(index.includes('data-i18n="sub.parser"'), 'home secondary navigation should describe parser children');
assert(index.includes('href="assets/style.css?v=20260526-1"'), 'home page should load CSS from assets/');
assert(index.includes('src="assets/main.js?v=20260526-1"'), 'home page should load JS from assets/');
assert(!index.includes('class="portal-menu"'), 'home page should not keep the removed common-entry menu');
assert(index.includes('data-i18n="portal.tools">解析工具</a>'), 'home primary navigation should consistently label the parser entry');
assert(index.includes('data-i18n="portal.tutorials"'), 'home primary navigation should include the tutorials category');
assert(index.includes('data-i18n="portal.protocol"'), 'home primary navigation should include the protocol category');
assert(!index.includes('portal-categories'), 'home page should not keep the removed left category navigation');
assert(index.indexOf('class="top-bar"') < index.indexOf('<header class="site-header"'), 'home navigation should sit above the page header');
assert(!index.includes('<link rel="canonical" href="">'), 'home page should not keep an empty canonical URL');
assert(index.includes('resource-section'), 'home page should link to content resources');
assert(index.includes('pages/privacy.html'), 'home page should link to the privacy policy');
assert(index.includes('pages/terms.html'), 'home page should link to terms');
assert(index.includes('pages/contact.html'), 'home page should link to contact');
assert(!index.includes('site-i18n.js'), 'home page should keep parser localization in main.js');

const siteI18n = fs.readFileSync('assets/site-i18n.js', 'utf8');
assert(siteI18n.includes('LANGUAGE_STORAGE_KEY'), 'static pages should reuse the persisted language setting');
assert(siteI18n.includes('bitstream-parser-language'), 'static page language should share storage with the parser page');
assert(siteI18n.includes('document.documentElement.lang'), 'static page localization should update the document language');
assert(siteI18n.includes('translateMeta'), 'static page localization should update page metadata');
for (const page of requiredPages) {
  const key = path.basename(page, '.html');
  assert(siteI18n.includes(`${key}:`) || siteI18n.includes(`'${key}':`), `site-i18n.js should translate ${page}`);
}
assert(siteI18n.includes('What is H.264?'), 'static page localization should include English article content');
assert(siteI18n.includes('Privacy Policy'), 'static page localization should include English legal content');
assert(siteI18n.includes('href="../index.html"'), 'static page English content should link back to the root parser');
assert(siteI18n.includes("replace(/^(\\.\\/|\\.\\.\\/)+/, '')"), 'static page localization should normalize relative links');

const robots = fs.readFileSync('robots.txt', 'utf8');
assert(robots.includes('User-agent: *'), 'robots.txt should define crawler access');
assert(robots.includes('Allow: /'), 'robots.txt should allow indexing');

const htmlFiles = [
  'index.html',
  ...fs.readdirSync('pages').filter(file => file.endsWith('.html')).map(file => path.join('pages', file))
];
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  for (const href of hrefs) {
    if (href.startsWith('#') || href.startsWith('http:') || href.startsWith('https:') || href.startsWith('mailto:')) continue;
    const target = href.split('#')[0].split('?')[0];
    if (!target) continue;
    assert(fs.existsSync(path.resolve(path.dirname(file), target)), `${file} links to missing local target ${href}`);
  }
}

console.log('site content assertions passed');
