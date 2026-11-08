export type StoreSettings = {
  storeName: string; currency: string; country: string;
  shippingFee: number; freeShippingThreshold: number; returnsDays: number;
  storefront?: { accentColor?: string; heroTitle?: string; heroSubtitle?: string; showAssistant?: boolean; promoVideoUrl?: string | null; instagram?: string; facebook?: string };
  branches?: { id: string; name: string; city?: string; latitude?: number; longitude?: number }[];
  displayCurrencies?: Record<string, number>; giftWrapFee?: number; deliveryOtp?: boolean; requireTerms?: boolean; sandboxPayments?: boolean;
};
export type Address = {
  id?: string; name: string; phone: string; city: string; street: string;
  latitude?: number; longitude?: number; label?: string; isDefault?: boolean;
  district?: string; building?: string; details?: string;
};
export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type CommerceOrder = {
  id: string; date: string; createdAt?: string; status: OrderStatus;
  total: number; subtotal: number; discount: number; shipping: number;
  currency: string; paymentMethod: 'cod' | 'wallet' | 'card'; paymentStatus: string;
  address: Address; driverId?: string;
  items: {productId: string; name: string; price: number; quantity: number}[];
  events?: {status: string; createdAt?: string; date?: string; at?: string; note?: string}[];
  extras?: OrderExtras | null;
};
export type OrderExtras = {
  branchId?: string | null; slot?: {date: string; window: string; label: string} | null; deliveryNotes?: string;
  gift?: {wrap: boolean; message: string; recipient: string; fee: number} | null; termsAcceptedAt?: string | null;
  payment?: {provider: string; brand: string; last4: string; reference: string; sandbox: boolean} | null;
  zone?: {id: string; name: string; etaMinutes: number} | null; tier?: string | null;
  rating?: {rating: number; driverRating: number | null; comment: string} | null;
  fulfillment?: {mode: 'standard' | 'express' | 'pickup'; tip: number; fee?: number; branchId?: string | null; branchName?: string; etaMinutes?: number; readyInMinutes?: number} | null;
};
export const orderLabels: Record<string, string> = {
  pending: 'بانتظار التأكيد', confirmed: 'تم التأكيد', preparing: 'قيد التجهيز',
  out_for_delivery: 'خرج للتوصيل', delivered: 'تم التسليم', cancelled: 'ملغي',
};
