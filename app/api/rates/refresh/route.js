import { createClient } from '@supabase/supabase-js';

// Bu endpoint sunucu tarafında (Vercel serverless function) çalışır, tarayıcıda değil.
// İki şekilde tetiklenir:
//   1) Vercel Cron Job (vercel.json içindeki "crons" ayarı) — günde bir kez otomatik.
//   2) Uygulama içindeki "Yenile" butonu — kullanıcı manuel tetikler.
//
// Kaynak: finans.truncgil.com — Türkiye'de döviz ve altın fiyatları için yaygın
// kullanılan, ücretsiz ve anahtarsız bir topluluk API'si. Bu API'nin alan adları
// zaman zaman değişebildiği için, aşağıdaki parseRates fonksiyonu her değer için
// birden fazla olası anahtar adını dener; hiçbiri bulunamazsa o alan boş (null)
// kalır ve uygulama arayüzü kullanıcıyı "elle giriniz" konusunda uyarır.

export const dynamic = 'force-dynamic';

function parseTrNumber(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const cleaned = String(val).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function extractValue(obj) {
  if (obj === undefined || obj === null) return null;
  if (typeof obj === 'number' || typeof obj === 'string') return parseTrNumber(obj);
  // Nesne ise olası satış/alış alanlarını dene (öncelik: Selling / Satış / sell / Buying / Alış)
  const candidates = ['Selling', 'Satış', 'satis', 'Satis', 'sell', 'Sell', 'selling', 'Buying', 'Alış', 'alis', 'Alis', 'buy'];
  for (const key of candidates) {
    if (obj[key] !== undefined) {
      const v = parseTrNumber(obj[key]);
      if (v !== null) return v;
    }
  }
  return null;
}

function findAndExtract(data, keyCandidates) {
  for (const key of keyCandidates) {
    if (data[key] !== undefined) {
      const v = extractValue(data[key]);
      if (v !== null) return v;
    }
  }
  // Anahtar adı eşleşmediyse, obje anahtarlarını normalize ederek (küçük harf,
  // Türkçe karakter sadeleştirme yok ama boşluk/tire farkı toleranslı) tekrar dene.
  const normalizedTargets = keyCandidates.map((k) => k.toLowerCase().replace(/[\s-]/g, ''));
  for (const rawKey of Object.keys(data)) {
    const normalizedKey = rawKey.toLowerCase().replace(/[\s-]/g, '');
    if (normalizedTargets.includes(normalizedKey)) {
      const v = extractValue(data[rawKey]);
      if (v !== null) return v;
    }
  }
  return null;
}

async function fetchFromTruncgil() {
  const resp = await fetch('https://finans.truncgil.com/v3/today.json', { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Truncgil API HTTP ${resp.status}`);
  const data = await resp.json();

  return {
    usd: findAndExtract(data, ['USD', 'ABD DOLARI', 'US Dollar', 'usd']),
    eur: findAndExtract(data, ['EUR', 'EURO', 'euro', 'eur']),
    gram_altin: findAndExtract(data, ['gram-altin', 'GRAM-ALTIN', 'Gram Altın', 'GRAM ALTIN', 'gram altin']),
    ceyrek_altin: findAndExtract(data, ['ceyrek-altin', 'CEYREK-ALTIN', 'Çeyrek Altın', 'CEYREK ALTIN']),
    tam_altin: findAndExtract(data, ['tam-altin', 'TAM-ALTIN', 'Tam Altın', 'TAM ALTIN']),
    cumhuriyet_altini: findAndExtract(data, ['cumhuriyet-altin', 'CUMHURIYET-ALTIN', 'Cumhuriyet Altını', 'CUMHURIYET ALTINI']),
    ata_altin: findAndExtract(data, ['ata-altin', 'ATA-ALTIN', 'Ata Altın', 'ATA ALTIN']),
    ayar_bilezik: findAndExtract(data, ['22-ayar-bilezik', '22 AYAR BILEZIK', '22 Ayar Bilezik', 'bilezik']),
  };
}

// USD/EUR için truncgil başarısız olursa yedek olarak dener (döviz için yaygın,
// stabil ve anahtarsız bir API).
async function fetchFxFallback() {
  const resp = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Yedek döviz API HTTP ${resp.status}`);
  const data = await resp.json();
  const usdTry = data?.rates?.TRY ?? null;
  const usdEur = data?.rates?.EUR ?? null;
  const eurTry = usdTry && usdEur ? usdTry / usdEur : null;
  return { usd: usdTry, eur: eurTry };
}

async function handleRefresh(request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = request.headers.get('authorization');
      const isVercelCron = authHeader === `Bearer ${cronSecret}`;
      const isManualCall = request.headers.get('x-manual-refresh') === 'true';
      if (!isVercelCron && !isManualCall) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ error: 'Supabase ortam değişkenleri eksik' }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    let parsed;
    try {
      parsed = await fetchFromTruncgil();
    } catch (e) {
      parsed = { usd: null, eur: null, gram_altin: null, ceyrek_altin: null, tam_altin: null, cumhuriyet_altini: null, ata_altin: null, ayar_bilezik: null };
    }

    if (parsed.usd === null || parsed.eur === null) {
      try {
        const fx = await fetchFxFallback();
        if (parsed.usd === null) parsed.usd = fx.usd;
        if (parsed.eur === null) parsed.eur = fx.eur;
      } catch (e) {
        // yedek de başarısız oldu, alanlar null kalır
      }
    }

    const now = new Date();
    const row = {
      id: 1,
      ...parsed,
      fetched_at: now.toISOString(),
      fetched_date_str: now.toISOString().slice(0, 10),
    };

    const { error } = await supabase.from('kasa_rates').upsert(row);
    if (error) throw error;

    return Response.json({ ok: true, rates: row });
  } catch (e) {
    return Response.json({ error: e.message || 'Bilinmeyen hata' }, { status: 500 });
  }
}

export async function GET(request) {
  return handleRefresh(request);
}
export async function POST(request) {
  return handleRefresh(request);
}
