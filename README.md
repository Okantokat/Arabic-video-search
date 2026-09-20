# Arabic-video-search

Video bağlantısı yapıştırmadan YouTube altyazılarında Arapça kelime/kalıp aramak için web uygulaması.

## Mimari

1. Filmot'un indekslediği YouTube altyazıları Parse'ın Filmot wrapper API'si üzerinden aranır.
2. Sonuçlarda video başlığı, kanal ve eşleşen altyazı parçası gösterilir.
3. Kullanıcı bir sonuçta "Zaman kodunu bul" dediğinde yalnızca o video Supadata üzerinden çözülür.
4. Böylece Supadata kotası her aramada onlarca video için tüketilmez.

## Ortam değişkenleri

```bash
PARSE_API_KEY='parse_anahtariniz'
SUPADATA_API_KEY='supadata_anahtariniz'
```

## Çalıştırma

```bash
npm install
npm start
```

## Not

Arama bütün YouTube'u canlı taramaz; Filmot'un indekslediği YouTube altyazı arşivinde arar. API anahtarlarını kaynak koda veya GitHub'a yazmayın.
