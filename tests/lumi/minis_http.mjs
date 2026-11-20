// Test helper (not a test file itself): Lumi over real HTTP on a random port with a faked login, for the garden and
// minigame route tests (same harness as lumi_web.test.mjs). Each test file gets its own process and database.
import { after } from "node:test";
import http from "node:http";
import { createRequire } from "node:module";
import { boot, setBalance } from "./lumi_env.mjs";

const require = createRequire(import.meta.url);

/** Boot Lumi, start a server and log `uid` in. -> { env, post(path, body), get(path), anon(path, opts) } */
export async function serve(uid, name = "Doll", purse = 1000) {
  process.env.WEB_PANEL_SESSION_SECRET = "test-secret-test-secret-test-secret-123"; // sessions need a signing secret
  const env = boot();                                                                 // in-memory economy + Lumi
  setBalance(env.eco, uid, purse);                                                    // their SGC
  setBalance(env.eco, "__LUMI_TOWN_BANK__", 100_000);                                 // the bank can pay
  const auth = require("../../src/webPanelAuth.js");                                  // to fake a Discord login
  const cookie = `lumi_sess=${encodeURIComponent(auth.createSession(uid, name, "", []))}`; // a logged-in browser
  const server = http.createServer((req, res) => {                                    // the gameWebServer hook
    const url = new URL(req.url, `http://${req.headers.host}`);
    env.lumi.handleLumiRequest(req, res, url).then((handled) => { if (!handled) { res.writeHead(404); res.end("not lumi"); } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));                         // random free port
  const port = server.address().port;
  after(() => { env.lumi.stopLumiGames(); server.close(); });                         // tidy up
  const origin = `http://127.0.0.1:${port}`;                                          // same-origin writes

  // One request; resolves { status, body (parsed JSON when possible) }.
  function request(path, { method = "GET", headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: `/lumipet${path}`, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { data += c; });
        res.on("end", () => { let parsed = data; try { parsed = JSON.parse(data); } catch { /* not JSON */ } resolve({ status: res.statusCode, body: parsed }); });
      });
      req.on("error", reject);
      if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
      req.end();
    });
  }
  return {
    env,
    get: (path) => request(path, { headers: { cookie } }),                            // a logged-in GET
    post: (path, body) => request(path, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body }), // a logged-in POST
    anon: (path, opts = {}) => request(path, { ...opts, headers: { origin, ...(opts.headers || {}) } }), // no session
  };
}
