import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommandCenterSnapshot, parseCommandCenterConfig, syncCommandCenter, testCommandCenter } from './commandCenter.ts';

const config = parseCommandCenterConfig(JSON.stringify({
  baseUrl: 'https://amer-ai-command-center.eagerlark64.chatgpt.site/',
  apiToken: 'service-example-123', siteAccessToken: 'site-example-456', automaticSync: false,
}));

test('owner config only accepts the exact dashboard origin and disabled automatic sync', () => {
  assert.equal(config.automaticSync, false);
  for (const baseUrl of ['https://fake.example/', 'https://amer-ai-command-center.eagerlark64.chatgpt.site.evil.test/', 'http://amer-ai-command-center.eagerlark64.chatgpt.site/']) {
    assert.throws(() => parseCommandCenterConfig(JSON.stringify({ ...config, baseUrl })));
  }
  assert.throws(() => parseCommandCenterConfig(JSON.stringify({ ...config, automaticSync: true })));
});

test('snapshot preserves real products and order lines while stripping customer and payment data', () => {
  const snapshot = buildCommandCenterSnapshot(
    [{ id: 'sku-one', name: 'منتج', category: 'عام', price: 12.5, stock: 3, image: 'http://unsafe.example/x', brand: 'لُقطة', secret: 'private' }],
    [{ id: 'order_1', date: '2026-10-23T12:00:00.000Z', status: 'pending', address: { name: 'PRIVATE CUSTOMER' }, paymentMethod: 'wallet', items: [{ productId: 'sku-one', name: 'منتج', price: 12.5, quantity: 2 }] }],
    'test-device', '1.1.0', 'لُقطة',
  );
  assert.equal(snapshot.products[0].stockQuantity, 3);
  assert.ok(snapshot.products[0].id > 0 && snapshot.products[0].id <= 2147483647);
  assert.equal(snapshot.products[0].imageUrl, '');
  assert.equal(snapshot.orders[0].productId, snapshot.products[0].id);
  assert.equal(snapshot.orders[0].totalPrice, 25);
  assert.equal(snapshot.orders[0].id, 'order_1_1');
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE CUSTOMER|wallet|secret/);
});

test('authenticated health and sync require the matching server receipt', async () => {
  const oldFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok', storage: 'D1' }), { status: 200 });
    return new Response(JSON.stringify({ revision: 7, receivedAt: '2026-10-23T12:00:00.000Z', productsAccepted: 1, ordersAccepted: 0 }), { status: 200 });
  };
  try {
    await testCommandCenter(config);
    const snapshot = buildCommandCenterSnapshot([{ id: 'x', name: 'منتج', price: 1, stock: 1 }], [], 'test-device', '1.1.0');
    const receipt = await syncCommandCenter(config, snapshot);
    assert.equal(receipt.productsAccepted, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.headers['X-AAS-API-Key'], config.apiToken);
    assert.equal(calls[1].options.headers['OAI-Sites-Authorization'], `Bearer ${config.siteAccessToken}`);
    assert.equal(calls[1].options.redirect, 'error');
  } finally { global.fetch = oldFetch; }
});
