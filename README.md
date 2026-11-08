# CyberFi Engine

CyberFi masaüstü uygulamasının ajan motoru dağıtım deposu. Motor, [Happy Agent](https://github.com/slopus/happy-agent) açık kaynak projesinden gelir. Dağıtım kopyalarında özgün arşiv biçimi ve varsa çalıştırılabilir dosya imzaları korunur; CyberFi menü metinleriyle yeniden derlenen paketler aşağıda belirtilir. [Lisans ve telif bildirimi](LICENSE-Happy-Agent.txt).

## macOS motoru 0.4.117

`.github/workflows/cyberfi-macos-engine.yml`, Windows 0.4.117 hattıyla aynı
`3d672e414d70804cf9f1b20b44d7243c78e063c3` açık kaynak revizyonunu kullanır.
Yerel ARM64 `macos-15` ve Intel `macos-15-intel` standart GitHub sunucularında
yamalı veritabanı/Watcher, Python worker ve Swift menüsüyle derler. Bu açık
depoda standart sunucular kullanılır; özel masaüstü kaynakları veya ücretli
büyük sunucular kullanılmaz.

Onaylanan spiral/devre simgesi Windows ICO kaynağına ve macOS yerel menüsüne gömülür. Mac simgesi beyaz boşluklarını koruyan 20 punto tam renkli PNG kullanır. Görünür menü/durum/ileti metinleri Türkçedir; yerel ürün ve çökme raporu kimliği CyberFi olur. CLI adı, API,
protokol ve lisans bildirimleri korunur. Paketler yerel **ad-hoc imzalıdır**;
Developer ID sertifikası veya Apple noter onayı içermez. İş akışı, her mimaride
imzayı ve yerel kütüphaneleri doğrular; gerçek motorun sürüm, taşıma protokolü
ve ayrı profilde başlat/durum/durdur kontrolleri geçmeden paket yayımlamaz.

`main` üzerinden elle çalıştırıldığında iki mimari de başarılı olursa yalnız
eksik Mac arşivlerini ve SHA-256 dosyalarını mevcut `v0.4.117` sürümüne ekler.
Var olan Mac dosyası varsa durur; hiçbir dosyanın üzerine yazmaz. Önceden
yayımlanan Windows varlıklarının kimlik, boyut ve özetlerini işlem sonunda
yeniden karşılaştırır. Sürüm başlığını, notlarını veya latest seçimini değiştirmez.

```sh
gh workflow run cyberfi-macos-engine.yml --repo CyberfiTechh/CyberFi-Engine --ref main
```

Bu komut derlemenin yanında başarılı sonuçların yayımlanmasını da başlatır.
İş akışının eklenmesi tek başına derleme veya yayın yapmaz.

Windows hattı yalnız yeni `v0.4.117` sürümünü oluşturur; eski bir sürümü veya varlığı değiştirmez. Ardından Mac hattı bu yeni sürüme iki mimariyi ekler. Önce Windows işi, başarılı olduktan sonra Mac işi çalıştırılır:

```sh
gh workflow run cyberfi-windows-engine.yml --repo CyberfiTechh/CyberFi-Engine --ref main
gh workflow run cyberfi-macos-engine.yml --repo CyberfiTechh/CyberFi-Engine --ref main
```

`branding/verify.mjs`, derlenmiş yerel tepsi dosyasındaki onaylı görsel baytlarını ve protokol dizgilerinin korunduğunu doğrular. Kanıt JSON dosyaları CI çıktılarında saklanır. Windows Authenticode mevcut `WINDOWS_SIGNING_ENABLED` ve imzalama ayarlarına bağlıdır; devre dışıysa paket imzasız olarak raporlanır. Mac yerel menüsü ve motoru ad-hoc imzalanır; noter onayı iddia edilmez. Kaynak yaması eklemek tek başına yeni paket üretmez veya yayımlamaz.

Yerleşik sesli yardımcı, görevi devretme ve masaüstü denetleyicisi yönergeleri Türkçe CyberFi metinleridir. Araç adları, JSON alanları, güvenlik ve insanın gönderme onayı kuralları korunur. Kullanıcının kaydettiği özel istemlere dokunulmaz. Bu yama JavaScript derlemesinden önce uygulanır; ses ayarı/özel istem testleri ve derlenmiş varsayılan metin doğrulaması yayın kontrollerindedir.

## K�s�tl� ajanlarda kurulu becerilerin okunmas�

0.4.117, Windows k�s�tl� ajanlar�n�n katalogda g�r�nen rol belgelerini ve destek dosyalar�n� okuyamamas�n� giderir. Yaln�z kurulu global beceri k�k�, a��k�a yap�land�r�lan beceri klas�rleri ve g�m�l� beceri k�k� salt okunur malzeme olarak tan�mlan�r. Ev dizini, onun �st dizinleri ve dosya sistemi k�k� bu istisnaya al�nmaz; �zel yol engelleri �nceliklidir. Yazma ve alt ajan�n salt okuma s�n�rlar� de�i�mez. Native dosya sistemi testi hem ebeveyn hem salt okuma alt ajan kipinde beceri/destek okumas�n�, �zel dosya ve yazma engellerini ve ba�lant� ka����n� denetler. 0.4.116 varl�klar� korunur.
