# CyberFi Engine

CyberFi masaüstü uygulamasının ajan motoru dağıtımı. Kaynak [Happy Agent](https://github.com/slopus/happy-agent), MIT lisansı ve [özgün bildirim](LICENSE-Happy-Agent.txt) korunur.

## 0.4.119 hazırlığı

Bu sürüm MCP teknik kimliği/görünen ad eşleşmesini, hesap tanımlı olmayan isteğe bağlı aramaların hata olarak işaretlenmesini ve yönetilen Python/ripgrep araçlarının dar salt okuma erişimini düzeltir. Gerçek ağ, kimlik doğrulama ve izin hataları gizlenmez. Var olan beceriler, kullanıcı ayarları, CyberFi simgesi ve Türkçe ses yönergeleri korunur.

Upstream kaynak `3d672e414d70804cf9f1b20b44d7243c78e063c3` sabittir. `branding/apply.mjs` yalnız doğrulanan kaynak yamasını uygular. Yayımlanan `@slopus/happy-agent-compute@0.1.30` bağımlılığına ait mevcut yama, kanonik tek SDK dosyasını ve sürümünü denetler; paylaşılan pnpm önbelleğini değiştirmez.

Windows hattı `v0.4.119` taslağını oluşturur; Intel ve ARM Mac hattı aynı taslağa yalnız eksik varlıkları ekler. Altı arşiv/özet varlığı ve üç mimarinin yerel kontrolleri doğrulanmadan genel yayın yapılmaz. Önceki motor yayınları veya varlıkları değiştirilmez.

Derleme; MCP/arama regresyonlarını, dar okuma politikalarını, yerel taşıma ve veritabanı/worker kontrollerini, gerçek derlenmiş motorda beceri/alt ajan sınırlarını, MCP ad eşleşmesini ve hesapsız arama sonucunu test eder. Windows imzası mevcut imzalama ayarlarına bağlıdır; Mac dosyaları ad hoc imzalıdır, Apple Developer ID/noter onayı yoktur.

```sh
gh workflow run cyberfi-windows-engine.yml --repo CyberfiTechh/CyberFi-Engine --ref main
gh workflow run cyberfi-macos-engine.yml --repo CyberfiTechh/CyberFi-Engine --ref main
```

İş akışları yalnız bu açık deponun `main` dalından çalışır. Mevcut etiket veya dosyanın üzerine yazılmaz. SDK, izin ve yerel imza kontrolleri korunur; yeni görev başlaması eski yayınları kaldırmaz.
