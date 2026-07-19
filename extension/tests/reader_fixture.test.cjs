const assert = require("node:assert/strict");
const test = require("node:test");
const { startReaderFixture } = require("./fixtures/reader/server.cjs");

test("deterministic reader fixture exposes the required offline source categories", async (context) => {
  const fixture = await startReaderFixture();
  context.after(() => fixture.close());

  const response = await fetch(`${fixture.origin}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  for (const marker of [
    "plain-src", "responsive-srcset", "picture-source", "data-src-image", "lazy-source-change",
    "infinite-scroll-root", "mutation-root", "same-url-changing-bytes", "remove-during-processing",
    "slice-parent", "banner", "aside-ad", "header-logo", "nav-icon", "avatar", "thumbnail",
    "data-url", "blob-url", "cross-origin", "cookie-sensitive", "referrer-sensitive", "shadow-host",
    "same-origin-frame", "css-background", "canvas-rendered",
  ]) {
    assert.match(html, new RegExp(`id=["']${marker}["']`), marker);
  }
  assert.match(html, new RegExp(fixture.assetOrigin.replaceAll(".", "\\.")));
});

test("deterministic reader fixture exposes a focused unpacked-extension E2E page", async (context) => {
  const fixture = await startReaderFixture();
  context.after(() => fixture.close());

  const response = await fetch(`${fixture.origin}/e2e`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /data-fixture="extension-e2e-v1"/);
  assert.match(html, /id="eligible-static"/);
  assert.match(html, /image\.id = "eligible-dynamic"/);
  assert.match(html, /id="below-threshold"/);
  assert.match(html, /id="one-dimension-small"/);
  assert.match(html, /id="fixture-logo"/);

  const png = await fetch(`${fixture.origin}/png/contract.png?w=300&h=301`);
  const bytes = Buffer.from(await png.arrayBuffer());
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(bytes.readUInt32BE(16), 300);
  assert.equal(bytes.readUInt32BE(20), 301);

  for (const [width, height] of [
    [16, 16], [64, 64], [128, 128], [299, 299],
    [300, 300], [301, 301], [300, 100], [100, 300],
  ]) {
    const response = await fetch(`${fixture.origin}/png/geometry-${width}x${height}.png?w=${width}&h=${height}`);
    const geometryBytes = Buffer.from(await response.arrayBuffer());
    assert.equal(geometryBytes.readUInt32BE(16), width);
    assert.equal(geometryBytes.readUInt32BE(20), height);
  }
});

test("deterministic reader fixture exposes the extreme geometry browser page", async (context) => {
  const fixture = await startReaderFixture();
  context.after(() => fixture.close());

  const response = await fetch(`${fixture.origin}/geometry-e2e`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /data-fixture="geometry-e2e-v1"/);
  assert.match(html, /id="eligible-extreme"/);
  assert.match(html, /geometry-768x32768\.png\?w=768&amp;h=32768/);
});

test("deterministic reader fixture exposes worker, navigation, and reload lifecycle pages", async (context) => {
  const fixture = await startReaderFixture();
  context.after(() => fixture.close());

  for (const lifecycleCase of ["worker", "navigation-a", "navigation-b", "reload"]) {
    const response = await fetch(`${fixture.origin}/lifecycle/${lifecycleCase}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, new RegExp(`data-lifecycle-case="${lifecycleCase}"`));
    assert.match(html, /id="lifecycle-primary"/);
  }
});

test("deterministic reader fixture models protected reads and same-url byte changes", async (context) => {
  const fixture = await startReaderFixture();
  context.after(() => fixture.close());

  const deniedCookie = await fetch(`${fixture.origin}/protected/cookie.svg`);
  const acceptedCookie = await fetch(`${fixture.origin}/protected/cookie.svg`, { headers: { Cookie: "reader_session=fixture" } });
  const deniedReferrer = await fetch(`${fixture.origin}/protected/referrer.svg`);
  const acceptedReferrer = await fetch(`${fixture.origin}/protected/referrer.svg`, { headers: { Referer: `${fixture.origin}/chapter/1` } });
  const first = await fetch(`${fixture.origin}/mutable-image`);
  const firstBytes = await first.text();
  await fetch(`${fixture.origin}/api/toggle-version`, { method: "POST" });
  const second = await fetch(`${fixture.origin}/mutable-image`);
  const secondBytes = await second.text();

  assert.equal(deniedCookie.status, 403);
  assert.equal(acceptedCookie.status, 200);
  assert.equal(deniedReferrer.status, 403);
  assert.equal(acceptedReferrer.status, 200);
  assert.equal(first.url, second.url);
  assert.notEqual(first.headers.get("x-fixture-version"), second.headers.get("x-fixture-version"));
  assert.notEqual(firstBytes, secondBytes);
});

test("referer fixture distinguishes missing, exact, and per-reader requests", async (context) => {
  const fixture = await startReaderFixture();
  context.after(() => fixture.close());
  const imageUrl = `${fixture.origin}/protected/referer.png`;

  const denied = await fetch(imageUrl);
  const chapterA = await fetch(imageUrl, { headers: { Referer: `${fixture.origin}/chapter/a` } });
  const chapterB = await fetch(imageUrl, { headers: { Referer: `${fixture.origin}/chapter/b` } });
  const bytesA = Buffer.from(await chapterA.arrayBuffer());
  const bytesB = Buffer.from(await chapterB.arrayBuffer());

  assert.equal(denied.status, 403);
  assert.equal(chapterA.status, 200);
  assert.equal(chapterB.status, 200);
  assert.equal(chapterA.headers.get("content-type"), "image/png");
  assert.deepEqual([...bytesA.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.notDeepEqual(bytesA, bytesB);
});

test("referer fixture models slow, hanging, and disconnected response bodies", async (context) => {
  const fixture = await startReaderFixture();
  context.after(() => fixture.close());

  const slowController = new AbortController();
  const slow = await fetch(`${fixture.origin}/protected/slow-body.png`, {
    headers: { Referer: `${fixture.origin}/chapter/a` },
    signal: slowController.signal,
  });
  const slowReader = slow.body.getReader();
  const firstChunk = await slowReader.read();
  assert.equal(slow.status, 200);
  assert.equal(firstChunk.done, false);
  assert.deepEqual([...firstChunk.value.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  slowController.abort();
  await assert.rejects(() => slowReader.read(), /abort/i);

  const hangingController = new AbortController();
  const hanging = await fetch(`${fixture.origin}/protected/hanging-body.png`, {
    headers: { Referer: `${fixture.origin}/chapter/a` },
    signal: hangingController.signal,
  });
  setTimeout(() => hangingController.abort(), 25);
  await assert.rejects(() => hanging.arrayBuffer(), /abort/i);

  const disconnected = await fetch(`${fixture.origin}/protected/disconnect-body.png`, {
    headers: { Referer: `${fixture.origin}/chapter/a` },
  });
  await assert.rejects(() => disconnected.arrayBuffer());
});

test("referer fixture exposes invalid image payloads and abortable large bodies", async (context) => {
  const fixture = await startReaderFixture();
  context.after(() => fixture.close());

  const html = await fetch(`${fixture.origin}/protected/html-as-image`);
  const fakeImage = await fetch(`${fixture.origin}/protected/fake-image.png`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type"), /^text\/html/);
  assert.match(await html.text(), /not an image/i);
  assert.equal(fakeImage.status, 200);
  assert.equal(fakeImage.headers.get("content-type"), "image/png");
  assert.equal((await fakeImage.text()).startsWith("not-png"), true);

  const largeController = new AbortController();
  const large = await fetch(`${fixture.origin}/protected/large-body.png`, {
    headers: { Referer: `${fixture.origin}/chapter/b` },
    signal: largeController.signal,
  });
  const reader = large.body.getReader();
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  largeController.abort();
  await assert.rejects(() => reader.read(), /abort/i);
});
