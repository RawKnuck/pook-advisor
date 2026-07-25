import fs from 'fs';
import path from 'path';

const faviconUrl = 'https://corpmachiavelli.com/wp-content/uploads/2026/04/cropped-vNre9Ntf_400x400-192x192.jpg';
const destPath = path.resolve('src/app/icon.png');

async function downloadFavicon() {
  console.log(`Downloading favicon from: ${faviconUrl}`);
  try {
    const res = await fetch(faviconUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch image: status ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.log(`Successfully saved favicon to: ${destPath}`);
  } catch (err) {
    console.error("Failed to download favicon:", err);
    process.exit(1);
  }
}

downloadFavicon();
