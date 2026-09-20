import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appUrl } from '../../lib/app-url.ts';

const withEnv = (value: string | undefined, fn: () => void) => {
  const before = process.env.NEXT_PUBLIC_APP_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = value;
  try { fn(); } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = before;
  }
};

test('a deployment host is never where somebody is sent', () => {
  // The real production value, which answers 404 and made every invite dead.
  withEnv('https://reach-app.vercel.app', () => {
    assert.equal(appUrl(), 'https://www.alcanzar.io');
  });
  withEnv('http://localhost:3000', () => {
    assert.equal(appUrl(), 'https://www.alcanzar.io');
  });
});

test('the origin somebody is already using wins', () => {
  // It cannot be stale: they are there.
  withEnv('https://reach-app.vercel.app', () => {
    assert.equal(appUrl({ url: 'https://www.alcanzar.io/api/groups/x/members' }), 'https://www.alcanzar.io');
  });
});

test('a preview deployment does not leak into a link', () => {
  withEnv(undefined, () => {
    assert.equal(appUrl({ url: 'https://reach-backend-abc123.vercel.app/api/x' }), 'https://www.alcanzar.io');
  });
});

test('a real configured domain is honoured', () => {
  withEnv('https://alcanzar.io/', () => {
    // And the trailing slash goes, so links are not built with a double one.
    assert.equal(appUrl(), 'https://alcanzar.io');
  });
});

test('nonsense is not somewhere to send anybody', () => {
  withEnv('not a url', () => assert.equal(appUrl(), 'https://www.alcanzar.io'));
  withEnv(undefined, () => assert.equal(appUrl(), 'https://www.alcanzar.io'));
});
