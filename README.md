# Kasa Defteri

Şirket kasa / gelir-gider / borç takip uygulaması. Next.js + Supabase (veritabanı) ile
yazıldı, Vercel'de ücretsiz olarak barındırılabilir.

## Özellikler

- Çoklu proje ("kasa"): her proje kendi gelir/gider/borç kaydını tutar
- Silinemeyen "Genel Şirket Giderleri" projesi: projelere bağlı olmayan harcamalar için
- Her proje içinde ve şirket genelinde **Borçlar** takibi (aldığımız / verdiğimiz, ödendi/ödenmedi)
- Borçları TL, Dolar, Euro, Gram Altın, Çeyrek/Tam/Cumhuriyet/Ata Altın veya 22 Ayar
  Bilezik cinsinden girme — güncel kur ile TL karşılığını otomatik hesaplar
- Kur/altın fiyatları günde bir kez (sabah ~10:00) otomatik güncellenir (Vercel Cron Job),
  ayrıca elle "Yenile" ile istediğin an tazelenebilir
- Basit isim + PIN girişi (gerçek kullanıcı hesabı değildir, bkz. Güvenlik notu)

## 1) Supabase kurulumu (ücretsiz)

1. https://supabase.com adresinde ücretsiz bir proje oluştur.
2. Sol menüden **SQL Editor**'ü aç, `supabase/schema.sql` dosyasının tüm içeriğini
   yapıştırıp **Run** ile çalıştır. Bu, gerekli tabloları ve erişim kurallarını oluşturur.
3. Sol menüden **Project Settings > API** sayfasına git. Şu iki değeri kopyala:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 2) Yerelde deneme (opsiyonel)

```bash
npm install
cp .env.local.example .env.local
# .env.local dosyasını açıp yukarıdaki iki değeri yapıştır
npm run dev
```

Tarayıcıda http://localhost:3000 adresini aç.

## 3) GitHub'a yükleme

```bash
git init
git add .
git commit -m "Kasa defteri ilk sürüm"
```

Sonra GitHub'da boş bir repo oluşturup talimatlarına göre `git remote add` + `git push` yap.

## 4) Vercel'e deploy

1. https://vercel.com → **Add New Project** → GitHub reponu seç.
2. **Environment Variables** kısmına ekle:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - (opsiyonel) `CRON_SECRET` — rastgele bir metin, kur güncelleme endpoint'ini korumak için
3. **Deploy** tuşuna bas. Birkaç dakika içinde `https://<proje-adın>.vercel.app` adresi hazır olur.

Bu adımdan sonra link kalıcıdır, sen/kardeşin bu adresi yer imlerine ekleyip
doğrudan kullanabilirsiniz.

### Otomatik kur güncellemesi (cron) hakkında

`vercel.json` içinde her gün UTC 07:00'de (Türkiye saatiyle 10:00) `/api/rates/refresh`
adresini tetikleyen bir cron job tanımlı. Vercel'in ücretsiz (Hobby) planındaki cron
job limitleri zaman zaman değişebiliyor — deploy sonrası Vercel panelinde
**Settings > Cron Jobs** kısmından gerçekten aktif olduğunu kontrol et. Cron çalışmasa
bile uygulama, sayfa her açıldığında "bugün için kur alınmış mı" kontrolü yapıp
gerekirse otomatik tazeliyor; ayrıca her zaman elle "Yenile" butonu da var.

## Veri kaynağı (döviz/altın fiyatları)

Fiyatlar, Türkiye'de yaygın kullanılan ücretsiz bir kaynaktan (finans.truncgil.com)
sunucu tarafında çekiliyor; USD/EUR için o kaynak başarısız olursa yedek bir döviz
API'sine geçiliyor. Bu kaynağın veri yapısı zamanla değişebilir — eğer bazı değerler
sürekli boş geliyorsa, uygulama seni "Kuru Yenile" ile zorlar, hâlâ boşsa "teknik bir
sorun var, elle giriniz" diye uyarır. Gerekirse `app/api/rates/refresh/route.js`
dosyasındaki anahtar adı eşleştirmelerini güncel API yanıtına göre düzeltmen gerekebilir.

## Güvenlik notu — önemli

Bu uygulama **Supabase Auth (gerçek kullanıcı girişi) kullanmıyor**, sadece uygulama
içinde isim + PIN kontrolü var. Veritabanı erişim kuralları (Row Level Security),
`anon` anahtarına sahip herkese okuma/yazma izni verecek şekilde açık bırakıldı.
Yani:

- Linki ve/veya Supabase anon key'ini bilen biri, PIN ekranını atlayıp veriye
  doğrudan API üzerinden de erişebilir.
- Bu, hassas/kritik finansal veriler için yeterli bir güvenlik seviyesi değildir —
  küçük ölçekli, güvenilir kişiler arasında (sen ve kardeşin gibi) paylaşılan iç
  kullanım için tasarlandı.
- İleride gerçek kullanıcı girişi (Supabase Auth: email/şifre veya magic link) ve
  buna göre daraltılmış RLS politikaları eklenerek güvenlik artırılabilir — istersen
  bu geliştirmeyi ayrıca yapabiliriz.

## Klasör yapısı

```
app/
  layout.js          → Kök layout, Google Fonts
  globals.css         → Tüm görsel tasarım (mevcut artifact sürümüyle birebir aynı)
  page.js             → Ana sayfa, KasaApp bileşenini render eder
  api/rates/refresh/  → Kur/altın fiyatı çeken sunucu fonksiyonu
components/
  KasaApp.js          → Tüm uygulama mantığı (React)
lib/
  supabaseClient.js   → Supabase bağlantısı + yardımcı fonksiyonlar
supabase/
  schema.sql          → Veritabanı tabloları ve erişim kuralları
vercel.json           → Günlük otomatik kur güncelleme (cron) ayarı
```
