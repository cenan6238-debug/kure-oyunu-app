# Ucretsiz Online Server Kurulumu (Render Free)

Bu proje Render Free icin optimize edildi:
- `healthCheckPath: /health`
- Frankfurt bolgesi
- Bos/atıl odalari otomatik temizleme
- Uygulamada otomatik sunucu uyandirma akisi

## 1) Render'a gir
- https://dashboard.render.com

## 2) Blueprint ile deploy et
- `New` -> `Blueprint`
- GitHub repo: `kure-oyunu-app`
- Render root'taki `render.yaml` dosyasini otomatik okuyacak
- `Apply` ile deploy'u baslat

## 3) Ayarlarin geldiginin kontrolu
- Servis adi: `cenan6238-kure-oyunu`
- Plan: `Free`
- Region: `Frankfurt`
- Health Check Path: `/health`

## 4) Canli URL testi
- Beklenen URL: `https://cenan6238-kure-oyunu.onrender.com`
- Health testi: `https://cenan6238-kure-oyunu.onrender.com/health`
- Oda listesi testi: `https://cenan6238-kure-oyunu.onrender.com/rooms`

## 5) Mobil uygulama
- Varsayilan sunucu adresi zaten sabit:
  - `https://cenan6238-kure-oyunu.onrender.com`
- Yani Android uygulamayi guncel APK ile kurunca ekstra URL girmen gerekmez.

## 6) Free plan gercegi (normal davranis)
- Sunucu bos kalinca uykuya gecer.
- Ilk baglanti 20-60 sn surebilir.
- Uygulamada `Oda Olustur / Hizli Esles` tiklayinca sunucu otomatik uyandirilir.
