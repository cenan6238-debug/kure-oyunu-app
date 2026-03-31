# Ucretsiz Online Server Kurulumu (Render)

Bu proje `render.yaml` ile hazirlandi. Tek yapman gereken Render'da blueprint deploy etmek.

## 1) Render'a gir
- https://dashboard.render.com

## 2) Blueprint ile tek tik deploy
- `New` -> `Blueprint`
- GitHub reposu olarak `kure-oyunu-app` sec
- Render, root'taki `render.yaml` dosyasini otomatik okuyacak
- `Apply` diyip deploy et

## 3) URL kontrolu
- Servis adi `cenan6238-kure-oyunu`
- Beklenen URL: `https://cenan6238-kure-oyunu.onrender.com`
- Test: `https://cenan6238-kure-oyunu.onrender.com/health`

## 4) Uygulama baglantisi
- Mobil uygulamadaki varsayilan sunucu zaten bu URL'ye ayarli:
  - `https://cenan6238-kure-oyunu.onrender.com`
- Yani deploy tamamlaninca uygulama yeniden derlenip kuruldugunda herkes internetten oynayabilir.

## Not
- Free planda server uykuya gecebilir.
- Ilk baglanti 20-60 sn surebilir.
