import fs from "node:fs";
import path from "node:path";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const ROOT_ASSETS = new Set(["/favicon.png", "/favicon.svg"]);

export function createStaticUi(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const indexFile = path.join(root, "index.html");

  return function serveStaticUi(req, res, pathname) {
    if (!["GET", "HEAD"].includes(req.method)) return false;
    if (pathname.startsWith("/api/") || pathname.startsWith("/v1/")) return false;
    if (!fs.existsSync(indexFile)) return false;
    if (!pathname.startsWith("/assets/") && pathname !== "/" && !ROOT_ASSETS.has(pathname) && path.extname(pathname)) {
      return false;
    }

    const assetPath = pathname.startsWith("/assets/")
      ? path.resolve(root, `.${pathname}`)
      : ROOT_ASSETS.has(pathname)
        ? path.resolve(root, `.${pathname}`)
      : indexFile;
    const relative = path.relative(root, assetPath);
    if (
      relative.startsWith("..")
      || path.isAbsolute(relative)
      || !fs.existsSync(assetPath)
      || !fs.statSync(assetPath).isFile()
    ) {
      return false;
    }
    const stat = fs.statSync(assetPath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME[path.extname(assetPath)] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": assetPath === indexFile ? "no-cache" : "public, max-age=31536000, immutable",
    });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(assetPath).pipe(res);
    return true;
  };
}
