const http = require('http');

const PORT = 3020;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/mcp/echo') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log(`[MOCK-MCP] Received request:`, data);
        
        // Echo back the payload
        const response = {
          jsonrpc: "2.0",
          result: `ECHO: ${JSON.stringify(data.params.arguments)}`,
          id: data.id
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (e) {
        res.writeHead(400);
        res.end("Invalid JSON");
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[MOCK-MCP] Server running at http://localhost:${PORT}/mcp/echo`);
});
