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
