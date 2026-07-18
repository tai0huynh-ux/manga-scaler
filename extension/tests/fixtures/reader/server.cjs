const http = require("node:http");

function syntheticSvg(label, width = 720, height = 1280, version = 1) {
  const safeLabel = String(label).replace(/[^a-z0-9._-]/gi, "-");
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${version % 2 ? "#f5f1e8" : "#dceef2"}"/>
  <path d="M0 ${Math.round(height * 0.25)} H${width} M0 ${Math.round(height * 0.75)} H${width}" stroke="#24333a" stroke-width="8"/>
  <text x="32" y="72" font-family="serif" font-size="36" fill="#182126">${safeLabel}-v${version}</text>
</svg>`);
}

function readerHtml(assetOrigin) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Deterministic Manga Reader Fixture</title>
  <style>
    body { margin: 0; background: #e8e0d2; color: #182126; font-family: Georgia, serif; }
    header, nav, aside, footer { padding: 8px; background: #d5c7b4; }
    main { width: min(900px, 100%); margin: auto; background: #fffdf7; }
    .reader-image { display: block; width: 100%; height: auto; }
    .fixture-background { width: 720px; height: 240px; background-image: url('/image/css-background.svg?w=720&h=240'); }
  </style>
</head>
<body data-fixture="deterministic-reader-v1">
  <header><img id="header-logo" alt="site logo" src="/image/logo.svg?w=64&h=64" width="64" height="64"></header>
  <nav><img id="nav-icon" alt="navigation icon" src="/image/nav.svg?w=32&h=32" width="32" height="32"></nav>
  <aside><img id="aside-ad" alt="advertisement" src="/image/ad.svg?w=300&h=600" width="300" height="600"></aside>
  <main id="reader">
    <img id="plain-src" class="reader-image" src="/image/plain.svg?w=720&h=1280" width="720" height="1280">
    <img id="responsive-srcset" class="reader-image" src="/image/srcset-small.svg?w=720&h=1280" srcset="/image/srcset-small.svg?w=720&h=1280 720w, /image/srcset-large.svg?w=1080&h=1920 1080w" sizes="100vw" width="720" height="1280">
    <picture id="picture-source"><source type="image/svg+xml" srcset="/image/picture.svg?w=720&h=1400"><img class="reader-image" src="/image/picture-fallback.svg?w=720&h=1400" width="720" height="1400"></picture>
    <img id="data-src-image" class="reader-image" data-src="/image/data-src.svg?w=720&h=1500" width="720" height="1500">
    <img id="lazy-source-change" class="reader-image" src="/image/placeholder.svg?w=720&h=400" data-final-src="/image/lazy-final.svg?w=720&h=1600" width="720" height="1600">
    <section id="infinite-scroll-root"></section>
    <section id="mutation-root"></section>
    <img id="same-url-changing-bytes" class="reader-image" src="/mutable-image" width="720" height="1280">
    <img id="remove-during-processing" class="reader-image" src="/image/removable.svg?w=720&h=1280" width="720" height="1280">
    <img id="slice-parent" class="reader-image" src="/image/tall.svg?w=512&h=16384" width="512" height="16384">
    <img id="banner" alt="banner" src="/image/banner.svg?w=1200&h=160" width="1200" height="160">
    <img id="avatar" alt="avatar" src="/image/avatar.svg?w=128&h=128" width="128" height="128">
    <img id="thumbnail" alt="thumbnail" src="/image/thumbnail.svg?w=240&h=320" width="240" height="320">
    <img id="data-url" class="reader-image" width="720" height="1280" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='1280'%3E%3Crect width='720' height='1280' fill='%23eee'/%3E%3C/svg%3E">
    <img id="blob-url" class="reader-image" width="720" height="1280">
    <img id="cross-origin" class="reader-image" crossorigin="anonymous" src="${assetOrigin}/cross-origin.svg?w=720&h=1280" width="720" height="1280">
    <img id="cookie-sensitive" class="reader-image" src="/protected/cookie.svg" width="720" height="1280">
    <img id="referrer-sensitive" class="reader-image" src="/protected/referrer.svg" width="720" height="1280">
    <div id="shadow-host"></div>
    <iframe id="same-origin-frame" src="/frame" title="same origin reader frame"></iframe>
    <div id="css-background" class="fixture-background"></div>
    <canvas id="canvas-rendered" width="720" height="1280"></canvas>
  </main>
  <footer><img id="footer-badge" alt="footer badge" src="/image/footer.svg?w=64&h=64" width="64" height="64"></footer>
  <script src="/fixture.js"></script>
</body>
</html>`;
}

const fixtureScript = `(() => {
  const dataSource = document.querySelector('#data-src-image');
  dataSource.src = dataSource.dataset.src;
  const lazy = document.querySelector('#lazy-source-change');
  queueMicrotask(() => { lazy.src = lazy.dataset.finalSrc; });
  const mutationImage = new Image();
  mutationImage.id = 'mutation-added';
  mutationImage.className = 'reader-image';
  mutationImage.width = 720;
  mutationImage.height = 1280;
  mutationImage.src = '/image/mutation.svg?w=720&h=1280';
  document.querySelector('#mutation-root').append(mutationImage);
  let appended = false;
  addEventListener('scroll', () => {
    if (appended) return;
    appended = true;
    const image = new Image();
    image.id = 'infinite-scroll-added';
    image.className = 'reader-image';
    image.width = 720;
    image.height = 1280;
    image.src = '/image/infinite.svg?w=720&h=1280';
    document.querySelector('#infinite-scroll-root').append(image);
  });
  const shadow = document.querySelector('#shadow-host').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<img id="shadow-image" src="/image/shadow.svg?w=720&h=1280" width="720" height="1280">';
  const blob = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="#d8e3d4"/></svg>'], { type: 'image/svg+xml' });
  document.querySelector('#blob-url').src = URL.createObjectURL(blob);
  const context = document.querySelector('#canvas-rendered').getContext('2d');
  context.fillStyle = '#f2eadc';
  context.fillRect(0, 0, 720, 1280);
  context.fillStyle = '#182126';
  context.font = '36px serif';
  context.fillText('synthetic canvas fixture', 32, 72);
  globalThis.readerFixture = {
    removeProcessingImage: () => document.querySelector('#remove-during-processing')?.remove(),
    toggleMutableBytes: () => fetch('/api/toggle-version', { method: 'POST' }),
  };
})();`;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

async function startReaderFixture() {
  let mutableVersion = 1;
  const assetServer = http.createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    const width = Number(url.searchParams.get("w")) || 720;
    const height = Number(url.searchParams.get("h")) || 1280;
    response.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
    response.end(syntheticSvg("cross-origin", width, height));
  });
  const assetAddress = await listen(assetServer);
  const assetOrigin = `http://127.0.0.1:${assetAddress.port}`;

  const mainServer = http.createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "reader_session=fixture; Path=/; SameSite=Lax", "Cache-Control": "no-store" });
      response.end(readerHtml(assetOrigin));
      return;
    }
    if (url.pathname === "/fixture.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      response.end(fixtureScript);
      return;
    }
    if (url.pathname === "/frame") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end('<!doctype html><img id="iframe-image" src="/image/iframe.svg?w=720&h=1280" width="720" height="1280">');
      return;
    }
    if (url.pathname === "/api/toggle-version" && request.method === "POST") {
      mutableVersion = mutableVersion === 1 ? 2 : 1;
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (url.pathname === "/mutable-image") {
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "X-Fixture-Version": String(mutableVersion) });
      response.end(syntheticSvg("mutable", 720, 1280, mutableVersion));
      return;
    }
    if (url.pathname === "/protected/cookie.svg") {
      if (!String(request.headers.cookie || "").includes("reader_session=fixture")) {
        response.writeHead(403, { "Content-Type": "text/plain" });
        response.end("fixture cookie required");
        return;
      }
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      response.end(syntheticSvg("cookie-sensitive"));
      return;
    }
    if (url.pathname === "/protected/referrer.svg") {
      if (!String(request.headers.referer || "").includes("127.0.0.1")) {
        response.writeHead(403, { "Content-Type": "text/plain" });
        response.end("fixture referrer required");
        return;
      }
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      response.end(syntheticSvg("referrer-sensitive"));
      return;
    }
    if (url.pathname.startsWith("/image/")) {
      const width = Number(url.searchParams.get("w")) || 720;
      const height = Number(url.searchParams.get("h")) || 1280;
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      response.end(syntheticSvg(url.pathname.split("/").at(-1), width, height));
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  });
  const mainAddress = await listen(mainServer);
  const origin = `http://127.0.0.1:${mainAddress.port}`;

  return {
    origin,
    assetOrigin,
    close: async () => Promise.all([
      new Promise((resolve) => mainServer.close(resolve)),
      new Promise((resolve) => assetServer.close(resolve)),
    ]),
  };
}

module.exports = { startReaderFixture, syntheticSvg };

if (require.main === module) {
  startReaderFixture().then((fixture) => {
    console.log(`Deterministic reader fixture: ${fixture.origin}`);
    const close = () => fixture.close().then(() => process.exit(0));
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
