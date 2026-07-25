import fs from 'fs';
import path from 'path';

const HOMEPAGE = 'https://corpmachiavelli.com/';
const OUTPUT_DIR = './src/data';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'essays.json');

// Helper to decode HTML entities and strip inner HTML tags
function decodeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '') // strip inner tags first
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8216;/g, "'")
    .replace(/&#8230;/g, "...")
    .replace(/\s+/g, ' ')
    .trim();
}

async function scrape() {
  console.log('Fetching homepage to get essay index...');
  const res = await fetch(HOMEPAGE);
  const html = await res.text();

  // Find all unique corpmachiavelli links
  const urlRegex = /href="(https:\/\/corpmachiavelli\.com\/([a-zA-Z0-9_-]+)\/)"/g;
  let match;
  const urls = new Set();
  while ((match = urlRegex.exec(html)) !== null) {
    const url = match[1];
    const slug = match[2];
    
    // Filter out non-essay slugs
    const ignoreSlugs = ['feed', 'wp-json', 'xmlrpc-php', 'wp-content', 'wp-includes', 'wp-admin', 'category', 'tag', 'comments', 'page'];
    if (!ignoreSlugs.includes(slug)) {
      urls.add(url);
    }
  }

  console.log(`Found ${urls.size} potential essay URLs.`);

  const essays = [];
  let count = 0;

  for (const url of urls) {
    count++;
    console.log(`[${count}/${urls.size}] Fetching ${url}...`);
    try {
      const response = await fetch(url);
      const pageHtml = await response.text();

      // Extract Title
      const titleMatch = pageHtml.match(/<title>([^<]+)<\/title>/i);
      let title = titleMatch ? titleMatch[1] : url;
      title = title.split(' &#8211;')[0].split(' |')[0]; // Clean up WordPress suffix
      title = decodeHtml(title);

      // Extract Content
      // Locate the main post content container
      const containerIndex = pageHtml.indexOf('elementor-widget-theme-post-content');
      if (containerIndex === -1) {
        console.warn(`Could not find post content container on ${url}. Skipping content parsing.`);
        continue;
      }

      const contentHtml = pageHtml.substring(containerIndex);
      
      // We extract all paragraphs (<p>), and headings (<h2>, <h4>, <h3>) in this content block
      // until we hit the end of the post content (like a share section or footer)
      const endOfPost = contentHtml.indexOf('Get The 55 Essays') !== -1 ? contentHtml.indexOf('Get The 55 Essays') : contentHtml.indexOf('</main>');
      const activeContentHtml = endOfPost !== -1 ? contentHtml.substring(0, endOfPost) : contentHtml;

      // Extract paragraphs and headings
      const blockRegex = /<(p|h2|h3|h4|h5|h6)[^>]*>(.*?)<\/\1>/gs;
      let blockMatch;
      const paragraphs = [];
      while ((blockMatch = blockRegex.exec(activeContentHtml)) !== null) {
        const tag = blockMatch[1];
        const rawText = blockMatch[2];
        const cleanedText = decodeHtml(rawText);
        
        // Skip empty paragraphs or standard signup text
        if (cleanedText && !cleanedText.includes('Subscribe Now') && !cleanedText.includes('Enter your email')) {
          if (tag.startsWith('h')) {
            paragraphs.push(`\n## ${cleanedText}\n`);
          } else {
            paragraphs.push(cleanedText);
          }
        }
      }

      const fullText = paragraphs.join('\n\n');
      essays.push({
        title,
        url,
        content: fullText
      });

      // Delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.error(`Failed to scrape ${url}:`, err);
    }
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write to essays.json
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(essays, null, 2));
  console.log(`Successfully scraped ${essays.length} essays and saved to ${OUTPUT_FILE}`);
}

scrape().catch(err => {
  console.error('Scraping failed:', err);
});
