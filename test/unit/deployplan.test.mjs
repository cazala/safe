import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHUNK, plan } from '../../scripts/deploy-lib.mjs';

const page = (id) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><script>var WC_PROJECT="' + id + '"</script><!--config-->' + '<p>' + 'x'.repeat(CHUNK * 2) + '</p>';

test('the config head is its own chunk: a new project ID redeploys only that chunk and the app', () => {
  const a = plan(page('a'.repeat(32)), '0x00'), b = plan(page('b'.repeat(32)), '0x00');
  assert.ok(a.steps[0].initcode.length < 400, 'head chunk is tiny');
  assert.notEqual(a.chunks[0], b.chunks[0]);
  assert.deepEqual(a.chunks.slice(1), b.chunks.slice(1));
  assert.notEqual(a.app, b.app);
});

test('pages without the marker are chunked as before', () => {
  const p = plan('<p>' + 'y'.repeat(CHUNK + 10) + '</p>', '0x00');
  assert.equal(p.chunks.length, 2);
});

test('vanity: the app gets a mined salt with leading zeros; the chunks keep theirs', async () => {
  const { mineSalt, create2 } = await import('../../scripts/deploy-lib.mjs');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><script>var WC_PROJECT="x"</script><!--config--><p>' + 'z'.repeat(CHUNK + 100) + '</p>';
  const plain = plan(html, '0x00'), vain = plan(html, '0x00', undefined, { vanity: 3 });
  assert.deepEqual(vain.chunks, plain.chunks);
  assert.ok(vain.app.startsWith('0x000'), vain.app);
  assert.equal(vain.steps.at(-1).salt, vain.appSalt);
  assert.equal(vain.app, create2(vain.appSalt, vain.steps.at(-1).initcode));
  assert.equal(mineSalt(vain.steps.at(-1).initcode, 3), vain.appSalt); // deterministic
  assert.ok(vain.steps.slice(0, -1).every((s) => s.salt === plain.salt));
});
