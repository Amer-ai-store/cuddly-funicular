import React, { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Shell } from '../components/Shell';
import { Button, Txt } from '../components/ui';
import { AccountCard, errorMessage, FormMessage } from '../components/AccountKit';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { buildCommandCenterSnapshot, parseCommandCenterConfig, syncCommandCenter, testCommandCenter, type CommandCenterConfig } from '../lib/commandCenter';

const CONFIG_KEY = 'luqta-command-center-owner-config-v1';
const DEVICE_KEY = 'luqta-command-center-device-v1';
type CatalogProduct = { id: string; name: string; category?: string; price: number; stock: number; image?: string; brand?: string };
type CatalogOrder = { id: string; date?: string; createdAt?: string; status: string; items: { productId: string; name: string; price: number; quantity: number }[] };

export default function CommandCenterScreen() {
  const session = useSession();
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const config = useRef<CommandCenterConfig | null>(null);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [receipt, setReceipt] = useState<{ revision: number; receivedAt: string; productsAccepted: number; ordersAccepted: number } | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    SecureStore.getItemAsync(CONFIG_KEY).then((raw) => {
      if (!active || !raw) return;
      try { config.current = parseCommandCenterConfig(raw); setConfigured(true); }
      catch { void SecureStore.deleteItemAsync(CONFIG_KEY); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage(''); setSuccess(false);
    try { await operation(); setSuccess(true); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const importFile = () => run(async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset || (asset.size && asset.size > 16_384)) throw new Error('حجم ملف الاتصال غير صالح.');
    let raw = '';
    try { raw = await FileSystem.readAsStringAsync(asset.uri); }
    finally { await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => {}); }
    const parsed = parseCommandCenterConfig(raw);
    await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(parsed));
    config.current = parsed;
    setConfigured(true); setReceipt(null);
    setMessage('حُفظ ملف الاتصال في تخزين الهاتف الآمن. لم تُرسل أي بيانات بعد. احذف الملف الأصلي من مجلد التنزيلات.');
  });
  const test = () => run(async () => {
    if (!config.current) throw new Error('استورد ملف اتصال المالك أولًا.');
    await testCommandCenter(config.current);
    setMessage('نجح اختبار الوصول إلى لوحة القيادة وقاعدة بياناتها. لم تُرسل بيانات المتجر بعد.');
  });
  const sync = () => run(async () => {
    if (!config.current) throw new Error('استورد ملف اتصال المالك أولًا.');
    if (!session.user || session.user.role !== 'admin') throw new Error('يلزم حساب مدير المتجر.');
    await testCommandCenter(config.current);
    const [catalog, orders, settings] = await Promise.all([
      api.get<{ products: CatalogProduct[] }>('/admin/products'),
      api.get<{ orders: CatalogOrder[] }>('/admin/orders'),
      api.get<{ settings: { storeName: string } }>('/settings'),
    ]);
    let deviceId = await SecureStore.getItemAsync(DEVICE_KEY);
    if (!deviceId) {
      deviceId = `luqta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      await SecureStore.setItemAsync(DEVICE_KEY, deviceId);
    }
    const snapshot = buildCommandCenterSnapshot(catalog.products, orders.orders, deviceId, Constants.expoConfig?.version || '1.1.0', settings.settings.storeName);
    const result = await syncCommandCenter(config.current, snapshot);
    setReceipt(result);
    setMessage(tr('أكدت اللوحة استلام {products} صنفًا و{orders} سطر طلب، مراجعة {revision}.', { products: result.productsAccepted, orders: result.ordersAccepted, revision: result.revision }));
  });
  const remove = () => run(async () => {
    await SecureStore.deleteItemAsync(CONFIG_KEY);
    config.current = null; setConfigured(false); setReceipt(null);
    setMessage('حُذف وصول لوحة القيادة من هذا الهاتف.');
  });

  if (Platform.OS === 'web') return <Shell title="مركز القيادة"><AccountCard><Txt>{tr('استيراد ملف الوصول متاح في تطبيق الهاتف فقط.')}</Txt></AccountCard></Shell>;
  if (!session.hydrated) return <Shell title="مركز القيادة"><AccountCard><Txt>{tr('جارٍ فحص جلسة المدير...')}</Txt></AccountCard></Shell>;
  if (!session.configured || !session.user || session.user.role !== 'admin') return <Shell title="مركز القيادة"><AccountCard><Txt>{tr('سجّل الدخول كمدير متجر بعد ربط خادم المتجر لتفعيل هذا الاتصال.')}</Txt><Button title="إعداد خادم المتجر" onPress={() => router.push('/connection')} /></AccountCard></Shell>;

  return <Shell title="مركز القيادة" subtitle="مزامنة موثقة مع لوحة Amer AI Command Center."><View style={{ maxWidth: 760, width: '100%', alignSelf: 'center', gap: 18 }}>
    <AccountCard>
      <Txt weight="bold" style={{ fontSize: 21 }}>{tr(configured ? 'ملف اتصال محفوظ على الهاتف' : 'لم يُستورد ملف الاتصال بعد')}</Txt>
      <Txt style={{ color: t.muted, lineHeight: 26 }}>{tr('نزّل ملف aas-app-connection.json من «الخوادم والربط» في لوحة القيادة الخاصة بك، ثم استورده هنا. يُحفظ المفتاح في مخزن الهاتف الآمن، ولا يُضمّن في التطبيق.')}</Txt>
      <Button title="استيراد ملف اتصال المالك" onPress={() => void importFile()} busy={busy} />
      {configured ? <><Button title="اختبار الوصول للوحة" secondary onPress={() => void test()} busy={busy} /><Button title="مزامنة الأصناف والطلبات الآن" onPress={() => void sync()} busy={busy} /><Button title="حذف وصول اللوحة من الهاتف" secondary onPress={() => void remove()} busy={busy} /></> : null}
      <FormMessage text={message ? tr(message) : ''} success={success} />
      {receipt ? <Txt selectable style={{ color: t.green, lineHeight: 26 }}>{tr('إيصال الاستلام: {at} · مراجعة {revision}', { at: receipt.receivedAt, revision: receipt.revision })}</Txt> : null}
    </AccountCard>
    <AccountCard><Txt weight="bold">{tr('حدود المزامنة')}</Txt><Txt style={{ color: t.muted, lineHeight: 26 }}>{tr('تُرسل أسماء الأصناف وأسعارها وكمياتها، وأسطُر الطلبات وحالاتها فقط. لا تُرسل أسماء العملاء أو عناوينهم أو طرق الدفع. سعر الجملة غير مسجل في المتجر حاليًا، لذلك يُرسل 0 حتى يُضاف حقل فعلي. كل إرسال يستبدل لقطة التطبيق السابقة في اللوحة، والمزامنة التلقائية معطّلة.')}</Txt></AccountCard>
  </View></Shell>;
}
