import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/main.js': ['main.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const port = Number(process.env.MOBILE_PREVIEW_PORT || 3191);
createServer(async (request, response) => {
  const file = files[new URL(request.url, 'http://localhost').pathname];
  if (!file) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(new URL(`../dist/${file[0]}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(data);
  } catch { response.writeHead(500).end('Run npm run mobile:build first.'); }
}).listen(port, '127.0.0.1', () => console.log(`Mobile preview: http://127.0.0.1:${port}`));
