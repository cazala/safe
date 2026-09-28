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
