# Arabic-video-search

Filmot'un YouTube altyazı indeksinde Arapça kelime ve kalıp arayan mobil uyumlu web uygulaması.

## Ne yapar?

- Kullanıcı video bağlantısı girmez.
- Arapça kelime veya kalıp yazar.
- Filmot API üzerinden Arapça YouTube altyazılarında arama yapılır.
- Otomatik ve manuel altyazı sonuçları birleştirilebilir.
- Video başlığı, kanal, ilgili altyazı cümlesi ve zaman kodu gösterilir.
- Zaman koduna dokununca YouTube doğrudan o saniyeden açılır.

> Not: Arama bütün YouTube'un canlı bir taraması değildir. Filmot'un indekslediği YouTube altyazı/transkript arşivini tarar.

## Gereksinim

Filmot Tube Metadata Archive API için RapidAPI anahtarı gerekir.

Ortam değişkenleri:

```bash
RAPIDAPI_KEY=rapidapi_anahtariniz
RAPIDAPI_HOST=filmot-tube-metadata-archive.p.rapidapi.com
```

`RAPIDAPI_HOST` verilmezse yukarıdaki varsayılan host kullanılır.

## Çalıştırma

```bash
npm install
export RAPIDAPI_KEY='BURAYA_RAPIDAPI_ANAHTARI'
npm start
```

Uygulama varsayılan olarak port 3000'de açılır.

## Güvenlik

API anahtarını kaynak koda, GitHub deposuna veya tarayıcı tarafındaki JavaScript dosyalarına yazmayın. Anahtar yalnızca sunucuda ortam değişkeni olarak tutulmalıdır.
