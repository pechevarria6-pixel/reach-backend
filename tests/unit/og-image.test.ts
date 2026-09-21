import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ogImage } from '../../lib/discovery/harvest.ts';

const BASE = 'https://bellamonica.com/';

test('the picture a venue publishes about itself', () => {
  const html = `<head><meta property="og:image" content="https://static.wixstatic.com/media/room.jpg"></head>`;
  assert.equal(ogImage(html, BASE), 'https://static.wixstatic.com/media/room.jpg');
});

test('attributes in either order, since both are written in the wild', () => {
  const html = `<meta content="https://x.com/a.jpg" property="og:image">`;
  assert.equal(ogImage(html, BASE), 'https://x.com/a.jpg');
});

test('a relative path becomes a real address', () => {
  assert.equal(ogImage('<meta property="og:image" content="/img/front.jpg">', BASE),
    'https://bellamonica.com/img/front.jpg');
});

test('twitter:image is taken when there is no og:image', () => {
  assert.equal(ogImage('<meta name="twitter:image" content="https://x.com/b.jpg">', BASE), 'https://x.com/b.jpg');
});

test('a data URI is not a photograph', () => {
  // Somebody's tracking pixel or a placeholder, and either puts a grey
  // square where a picture of the room belongs.
  assert.equal(ogImage('<meta property="og:image" content="data:image/gif;base64,R0lGOD">', BASE), null);
});

test('an SVG is a logo, not a room', () => {
  assert.equal(ogImage('<meta property="og:image" content="https://x.com/logo.svg">', BASE), null);
});

test('a venue that publishes none keeps the gradient', () => {
  assert.equal(ogImage('<html><body>Welcome</body></html>', BASE), null);
  assert.equal(ogImage('', BASE), null);
});
