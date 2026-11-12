# CyberFi Engine

CyberFi masaüstü uygulamasının ajan motoru dağıtımı. Kaynak [Happy Agent](https://github.com/slopus/happy-agent), MIT lisansı ve [özgün bildirim](LICENSE-Happy-Agent.txt) korunur.

## 0.4.128 hazırlığı

Bu aday sürüm, açık araç kimliği arandığında doğru aracı önce getirir; böylece yönetici alt ajanları gereksiz keşif turları olmadan başlatabilir. Alt ajan geçmişindeki sınırlı mesaj ve çalışma kimlikleri, yöneticinin sonuçları gerçek kanıtla doğrulayıp görevleri Bitti sütununa taşımasını sağlar. Keşif çağrısı sınırı, erişim kontrolleri ve geçmişin bağlam bütçesi korunur.

Kanonik düzeltilmiş kaynak `28203c23edc5a6d30c6f908601618b3abd25ba99`; sabit upstream `3d672e414d70804cf9f1b20b44d7243c78e063c3` üzerine önceki yamalar ve `branding/provider-history-completion.patch` uygulanır. `branding/engine128-source.json` 18 dosyanın özetlerini kaydeder. Yayımlanmış `@slopus/happy-providers@0.0.53`, pnpm yaması ve donmuş kilit dosyasıyla kullanılır; derleme öncesi kontrol gerçek çözümlenen modülün kanonik derlenmiş dosyayla birebir eşleşmesini zorunlu tutar. Önceki çalışma planı ve 126 yamaları değiştirilmez.

Windows hattı yeni `v0.4.128` taslağını oluşturur; Intel ve ARM Mac hattı aynı taslağa yalnız eksik varlıkları ekler. Üç mimari, altı arşiv/özet varlığı ve masaüstü kabul kontrolleri tamamlanmadan kararlı yayın yapılmaz. Önceki yayınlar ve varlıklar korunur.

Windows özel motor denemesinde gerçek yönetici iki alt ajanı başlatıp sonuçlarını doğrulayarak iki görevi tamamladı. Üç mimarinin sürüm 128 yerel kontrolleri ayrıca CI üzerinde çalışır. CyberFi simgeleri, Türkçe ses varsayılanları, MCP kimlikleri, kullanıcı ayarları, Unicode komutları ve dosyaları koruyan arşivleme davranışı korunur. Mac imzası ad hoc olup Developer ID/noter onayı değildir.

```sh
gh workflow run cyberfi-windows-engine.yml --repo CyberfiTechh/CyberFi-Engine --ref main
gh workflow run cyberfi-macos-engine.yml --repo CyberfiTechh/CyberFi-Engine --ref main
```

İş akışları yalnız bu açık deponun `main` dalından çalışır. Mevcut etiket veya dosyanın üzerine yazılmaz. SDK, izin ve yerel imza kontrolleri korunur; yeni görev başlaması eski yayınları kaldırmaz.
