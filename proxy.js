import http from 'node:http';
import httpProxy from 'http-proxy';

// 1. Create the proxy instance
const proxy = httpProxy.createProxyServer({});

// 2. Routing map

function getTarget(sHost){
    return "http://localhost:8080";
}

// 3. Create HTTP server
const server = http.createServer((req, res) => {
  const target = getTarget(req.headers.host);
  
  if (target) {
    proxy.web(req, res, { target });
  } else {
    res.writeHead(404);
    res.end('Host not found');
  }
});

// 4. Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  const target = getTarget(req.headers.host);
  
  if (target) {
    proxy.ws(req, socket, head, { target });
  } else {
    socket.destroy();
  }
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy Error:', err.message);
  // If it's a standard HTTP request, send a 502
  if (res.writeHead && !res.headersSent) {
    res.writeHead(502);
    res.end('Bad Gateway');
  }
});

server.listen(8000);