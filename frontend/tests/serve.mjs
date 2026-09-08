import http from "node:http";
import { readFile } from "node:fs/promises";
const routes = new Map([
  ["/", [new URL("./fixture.html", import.meta.url), "text/html"]],
  ["/fixture.mjs", [new URL("./fixture.mjs", import.meta.url), "text/javascript"]],
  [
    "/panel.js",
    [
      new URL("../../custom_components/hikvision_intercom/frontend/panel.js", import.meta.url),
      "text/javascript",
    ],
  ],
]);
const sample = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#a1b2ad"/><path d="M0 0h800v140H0z" fill="#d1d8d1"/><path d="M0 450l160-175h480l160 175z" fill="#778783"/><rect x="175" y="52" width="450" height="294" fill="#465b54"/><rect x="200" y="71" width="400" height="260" fill="#183530"/><path d="M225 71v260m35-260v260m35-260v260m35-260v260m35-260v260m35-260v260m35-260v260m35-260v260m35-260v260m35-260v260" stroke="#577168" stroke-width="10"/><rect x="388" y="160" width="9" height="70" rx="4" fill="#a2b3a8"/><rect x="32" y="262" width="95" height="90" fill="#748575"/><circle cx="80" cy="240" r="69" fill="#456f53"/><rect x="655" y="280" width="111" height="90" fill="#748575"/><circle cx="710" cy="234" r="82" fill="#3c6b49"/><rect x="14" y="14" width="106" height="31" rx="6" fill="#0a3024bb"/><text x="25" y="36" font-family="Arial" font-size="18" fill="#fff">DEMO</text></svg>`;
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/camera_proxy/")) {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      res.end(sample);
      return;
    }
    const route = routes.get(url.pathname);
    if (!route) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      res.writeHead(200, { "Content-Type": route[1], "Cache-Control": "no-store" });
      res.end(await readFile(route[0]));
    } catch {
      res.writeHead(500);
      res.end();
    }
  })
  .listen(8765, "127.0.0.1");
