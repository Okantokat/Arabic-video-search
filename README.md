# Arabic-video-search

Fasih Arapça videolarda kelime ve kalıp aramak için küçük bir web uygulaması.

## Çalıştırma

```bash
npm install
export SUPADATA_API_KEY='BURAYA_API_ANAHTARI'
npm start
```

Uygulama varsayılan olarak port 3000'de açılır.

## Transkript sağlayıcısı

Bulut ortamlarında YouTube, doğrudan altyazı kazıma isteklerini bot kontrolüyle engelleyebildiği için uygulama Supadata Transcript API kullanır. API anahtarı `SUPADATA_API_KEY` ortam değişkeninde tutulur ve GitHub deposuna yazılmamalıdır.
