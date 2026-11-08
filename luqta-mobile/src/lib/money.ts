import { useI18n } from "./i18n";
import { useStore } from "./store";

// Prices are charged in the store currency; a chosen display currency only adds an approximate conversion.
export function formatMoney(amount: number, currency: string, lang: "ar" | "en" = "ar") {
  try {
    return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", { style: "currency", currency, maximumFractionDigits: 3 }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}
export function convert(amount: number, rates: Record<string, number> | undefined, target: string | null) {
  const rate = target && rates ? rates[target] : undefined;
  return rate ? Math.round(amount * rate * 100) / 100 : null;
}
export function useMoney() {
  const { settings } = useStore();
  const { lang, displayCurrency } = useI18n();
  const rates = settings.displayCurrencies;
  const format = (amount: number, currency = settings.currency) => formatMoney(amount, currency, lang);
  const approx = (amount: number) => {
    const value = displayCurrency && displayCurrency !== settings.currency ? convert(amount, rates, displayCurrency) : null;
    return value === null ? null : `≈ ${formatMoney(value, displayCurrency as string, lang)}`;
  };
  return { format, approx, currency: settings.currency, displayCurrency, rates: rates || {} };
}
