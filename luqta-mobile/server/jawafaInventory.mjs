/** Validated, read-only Jawafa stock snapshot adapter. No SQL access here. */
export function prepareJawafaSnapshot(payload, currentTime = Date.now()) {
  if (!payload || payload.schema !== 'jawafa-inventory-v1') throw new Error('عقد المخزون غير معتمد: jawafa-inventory-v1 مطلوب');
  const at = Date.parse(payload.snapshotAt);
  if (!Number.isFinite(at) || at > currentTime + 300_000 || currentTime - at > 86_400_000) throw new Error('لقطة المخزون قديمة أو وقتها غير صالح؛ أوقف الاستيراد');
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 2000) throw new Error('عدد أصناف اللقطة غير صالح');
  const seen = new Set();
  const whole = (value, label) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10_000_000) throw new Error(`قيمة ${label} ليست عددًا صحيحًا غير سالب`);
    return value;
  };
  const details = [];
  const items = payload.items.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('سجل صنف فارغ');
    const id = item.id || item.sku;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || seen.has(id)) throw new Error('معرف صنف مكرر أو غير صالح');
    seen.add(id);
    const ready = whole(item.readyQuantity, 'الكمية الجاهزة');
    const unposted = whole(item.unpostedSalesQuantity, 'المبيعات غير المرحلة');
    if (unposted > ready) throw new Error(`المبيعات غير المرحلة تتجاوز الجاهز للصنف ${id}`);
    const effective = ready - unposted;
    if (item.actualQuantity !== undefined && whole(item.actualQuantity, 'الكمية الفعلية') !== effective) throw new Error(`تعارض بين الكمية الفعلية والجاهزة/غير المرحلة للصنف ${id}`);
    const normalized = { id, sku: typeof item.sku === 'string' ? item.sku : id, stock: effective };
    details.push({ id, name: typeof item.name === 'string' ? item.name : id, family: typeof item.familyName === 'string' ? item.familyName : item.category || '', readyQuantity: ready, unpostedSalesQuantity: unposted, actualQuantity: effective });
    for (const key of ['name','category','familyName','familyCode','description','brand','image']) if (typeof item[key] === 'string') normalized[key] = item[key];
    if (typeof item.price === 'number') normalized.price = item.price;
    return normalized;
  });
  return { items, details, snapshotAt: new Date(at).toISOString(), source: 'jawafa-inventory-v1', count: items.length, onlyCommerceWrites: true };
}
