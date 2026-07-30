import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Bilerek burada throw etmiyoruz; arayüz "Supabase bağlantısı eksik" uyarısı gösterecek.
  console.warn(
    'NEXT_PUBLIC_SUPABASE_URL veya NEXT_PUBLIC_SUPABASE_ANON_KEY tanımlı değil. ' +
    '.env.local dosyasını kontrol et.'
  );
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

export const GENERAL_ID = '__genel__';

export const CURRENCIES = {
  TRY: { label: 'TL', unit: null },
  USD: { label: 'Dolar (USD)', unit: null },
  EUR: { label: 'Euro (EUR)', unit: null },
  GRAM_ALTIN: { label: 'Gram Altın', unit: 'gram' },
  CEYREK_ALTIN: { label: 'Çeyrek Altın', unit: 'adet' },
  TAM_ALTIN: { label: 'Tam Altın', unit: 'adet' },
  CUMHURIYET_ALTINI: { label: 'Cumhuriyet Altını', unit: 'adet' },
  ATA_ALTIN: { label: 'Ata Altın', unit: 'adet' },
  AYAR_BILEZIK: { label: '22 Ayar Bilezik', unit: 'gram' },
};

export function fmtMoney(n) {
  const val = typeof n === 'number' && !isNaN(n) ? n : 0;
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val) + ' ₺';
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function currencyMeta(code) {
  return CURRENCIES[code] || { label: code || 'TL', unit: null };
}

const RATE_KEYS = ['usd', 'eur', 'gram_altin', 'ceyrek_altin', 'tam_altin', 'cumhuriyet_altini', 'ata_altin', 'ayar_bilezik'];

export function invalidRateKeys(rates) {
  if (!rates) return [];
  return RATE_KEYS.filter((k) => {
    const v = rates[k];
    return v === undefined || v === null || typeof v !== 'number' || isNaN(v);
  }).map((k) => k.toUpperCase());
}

// Borcun TL karşılığı. Borç alınırken bir kur "dondurulmuşsa" (rate_snapshot) o kur
// kullanılır — böylece eski bir altın/döviz borcunun TL karşılığı, güncel kur
// değiştikçe geriye dönük olarak değişmez. Dondurulmuş kur yoksa (eski kayıtlar,
// veya kullanıcı elle girmediyse) güncel kur kullanılır.
export function debtTRYValue(debt, rates) {
  if (!debt.currency || debt.currency === 'TRY') return Number(debt.amount);
  if (debt.rate_snapshot) return Number(debt.amount) * Number(debt.rate_snapshot);
  const rateKey = debt.currency.toLowerCase();
  const rate = rates ? rates[rateKey] : null;
  return rate ? Number(debt.amount) * Number(rate) : 0;
}

// debtTRYValue'nun aksine dondurulmuş kuru hiç kullanmaz, her zaman güncel kurla
// hesaplar — "bugün alsaydım/ödesem ne tutardı" karşılaştırması için.
export function debtTRYValueLive(debt, rates) {
  if (!debt.currency || debt.currency === 'TRY') return Number(debt.amount);
  const rateKey = debt.currency.toLowerCase();
  const rate = rates ? rates[rateKey] : null;
  return rate ? Number(debt.amount) * Number(rate) : 0;
}

export function debtInstallmentsFor(debt, installments) {
  return installments.filter((i) => i.debt_id === debt.id).sort((a, b) => a.installment_no - b.installment_no);
}

// Bir borca ait ödenen tutar. Taksitli (kredi) borçlarda ödenen taksitlerin toplamı,
// değilse serbest ödeme defterinin (kasa_debt_payments) toplamıdır. `paid` bayrağı
// bu özellik eklenmeden önce tek tıkla "tam ödendi" işaretlenmiş eski kayıtlar için
// geriye dönük uyumluluk sağlar: ödeme kaydı yoksa ama paid=true ise, tutarın
// tamamı ödenmiş sayılır.
export function debtPaidAmount(debt, payments, installments) {
  const debtInstallments = installments ? debtInstallmentsFor(debt, installments) : [];
  if (debtInstallments.length > 0) {
    return debtInstallments.filter((i) => i.paid).reduce((s, i) => s + Number(i.amount), 0);
  }
  const sum = payments
    .filter((p) => p.debt_id === debt.id)
    .reduce((s, p) => s + Number(p.amount), 0);
  if (sum === 0 && debt.paid) return Number(debt.amount);
  return sum;
}

export function debtRemaining(debt, payments, installments) {
  const remaining = Number(debt.amount) - debtPaidAmount(debt, payments, installments);
  return remaining > 0.0001 ? remaining : 0;
}

export function isDebtSettled(debt, payments, installments) {
  return debtRemaining(debt, payments, installments) <= 0.0001;
}

export function addMonthsToDateStr(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1 + months, d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function buildInstallmentAmounts(total, count) {
  const base = Math.round((total / count) * 100) / 100;
  const amounts = new Array(count).fill(base);
  const lastAmount = Math.round((total - base * (count - 1)) * 100) / 100;
  amounts[count - 1] = lastAmount;
  return amounts;
}
