import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { APP_VERSION } from "../version.js";

const root = new URL("../", import.meta.url);

test("service worker cache version matches APP_VERSION", async () => {
  const sw = await readFile(new URL("sw.js", root), "utf8");
  assert.match(sw, new RegExp(`const VERSION = "${APP_VERSION.replace(/\./g, "\\.")}";`));
});

test("service worker caches every front-end file", async () => {
  const sw = await readFile(new URL("sw.js", root), "utf8");
  const files = (await readdir(root)).filter(
    (name) => /\.(js|html|css|webmanifest)$/.test(name) && name !== "sw.js",
  );
  for (const name of files) assert.ok(sw.includes(`"./${name}"`), `${name} missing from ASSETS`);
  assert.ok(sw.includes('"./icons/icon-192.png"'));
  assert.ok(sw.includes('"./icons/icon-512.png"'));
});

test("manifest declares standalone display and both icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
});
