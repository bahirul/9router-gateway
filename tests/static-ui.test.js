import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStaticUi } from "../src/static-ui.js";

function response() {
  return {
    headers: null,
    status: null,
    ended: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end() {
      this.ended = true;
    },
  };
}

test("serves the SPA shell with security headers and leaves API paths alone", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-router-ui-"));
  fs.writeFileSync(path.join(directory, "index.html"), "<main>dashboard</main>");
  fs.writeFileSync(path.join(directory, "favicon.svg"), "<svg></svg>");
  const serve = createStaticUi(directory);

  const head = response();
  assert.equal(serve({ method: "HEAD" }, head, "/dashboard/routing", true), true);
  assert.equal(head.status, 200);
  assert.equal(head.ended, true);
  assert.equal(head.headers["X-Frame-Options"], "DENY");
  assert.match(head.headers["Content-Security-Policy"], /frame-ancestors 'none'/);

  const favicon = response();
  assert.equal(serve({ method: "HEAD" }, favicon, "/favicon.svg", true), true);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers["Content-Type"], "image/svg+xml");

  assert.equal(serve({ method: "GET" }, response(), "/api/admin/status", true), false);
  assert.equal(serve({ method: "GET" }, response(), "/favicon.ico", true), false);
  assert.equal(serve({ method: "GET" }, response(), "/", false), false);
});
