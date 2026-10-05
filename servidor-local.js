// Servidor estático só para testar no PC: node servidor-local.js  ->  http://localhost:5180
const http = require("http"), fs = require("fs"), path = require("path");
const raiz = __dirname, porta = 5180;
const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".json": "application/json" };

http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const arq = path.join(raiz, rel);
  if (!arq.startsWith(raiz)) { res.writeHead(403); return res.end(); }
  fs.readFile(arq, (err, dados) => {
    if (err) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": tipos[path.extname(arq)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(dados);
  });
}).listen(porta, () => console.log(`Guincho app em http://localhost:${porta}`));
