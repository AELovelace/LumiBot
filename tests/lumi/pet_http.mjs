// Test helper (not a test itself): a throwaway HTTP server around src/lumi (like lumi_web.test.mjs), and logged-in
// clients that GET / POST JSON as a Discord-shaped player. Used by the town and city route tests.
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.WEB_PANEL_SESSION_SECRET = process.env.WEB_PANEL_SESSION_SECRET || "test-secret-test-secret-test-secret-123"; // sessions need a secret

/** Start a server for an already-booted lumi; resolves { port, close() }. */
export async function serve(lumi) {
  const server = http.createServer((req, res) => {                     // gameWebServer's hook
    const url = new URL(req.url, `http://${req.headers.host}`);        // parse
    lumi.handleLumiRequest(req, res, url).then((handled) => { if (!handled) { res.writeHead(404); res.end("not lumi"); } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));          // a random free port
  return { port: server.address().port, close: () => server.close() }; // handle
}

/** A logged-in player: { id, get(path), post(path, body), stream(path) } with paths under /lumipet/api/. */
export function client(port, id, name) {
  const auth = require("../../src/webPanelAuth.js");                  // fake a Discord login
  const cookie = `lumi_sess=${encodeURIComponent(auth.createSession(id, name, "", []))}`; // the session cookie
  const origin = `http://127.0.0.1:${port}`;                           // same-origin for writes
  function call(method, path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: `/lumipet/api/${path}`, method,
        headers: { host: `127.0.0.1:${port}`, cookie, origin, "content-type": "application/json" } }, (res) => {
        let data = "";                                                 // the body
        res.setEncoding("utf8");
        res.on("data", (c) => { data += c; });
        res.on("end", () => { let json = null; try { json = JSON.parse(data); } catch { json = null; } resolve({ status: res.statusCode, json, body: data }); });
      });
      req.on("error", reject);
      if (body !== undefined) req.write(JSON.stringify(body));         // JSON body
      req.end();
    });
  }
  /** Open an SSE stream; resolves { frames: [], close() } once the headers arrive. */
  function stream(path) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: `/lumipet/api/${path}`, method: "GET", headers: { host: `127.0.0.1:${port}`, cookie } }, (res) => {
        const handle = { status: res.statusCode, text: "", close: () => req.destroy() }; // collected text
        res.setEncoding("utf8");
        res.on("data", (c) => { handle.text += c; });
        res.on("error", () => {});
        resolve(handle);
      });
      req.on("error", (e) => { if (e.code !== "ECONNRESET") reject(e); });
      req.end();
    });
  }
  return { id, get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b), stream };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));     // a little pause
