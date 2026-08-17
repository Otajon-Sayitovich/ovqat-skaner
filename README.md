# Ovqat tarqatish — mustaqil QR skaner

Jonli QR skaner: kamerani kodga tutasiz, o'zi o'qiydi, o'quvchi ma'lumoti chiqadi,
siz faqat **Saqlash** yoki **Bekor qilish** bosasiz.

Nega alohida sahifa: Apps Script web-app'i Google'ning himoyalangan iframe'ida ochiladi
va u yerda kamera oqimi (`getUserMedia`) hamda Service Worker ishlamaydi. Bu sahifa
o'z manzilida turgani uchun ikkalasi ham ishlaydi. **Baza baribir o'sha Google Sheets** —
bu sahifa faqat Apps Script API orqali u bilan gaplashadi.

| | Apps Script ichidagi skaner | Bu sahifa |
|---|---|---|
| Skanerlash | tugma → surat → natija | kamerani tutasiz, o'zi o'qiydi |
| Bir o'quvchi | ~4 soniya | ~1 soniya |
| Internet uzilsa | sahifa ochilmaydi | ochiladi va to'liq ishlaydi |

---

## Fayllar

```
skaner/
├── index.html            interfeys
├── app.js                mantiq (skaner, offline navbat, sinxronizatsiya)
├── jsQR.js               QR o'qish kutubxonasi (MIT)
├── sw.js                 Service Worker — internetsiz ochilishi uchun
├── manifest.webmanifest  telefon ilovasi sifatida o'rnatish uchun
├── icon-192.png
└── icon-512.png
```

Hammasi statik fayl — server, build, Node.js kerak emas.

---

## O'rnatish

### 1. Apps Script tomonini yangilang

Skaner API si (`Api.gs`) qo'shilgani uchun server kodini qaytadan qo'yish kerak:

`bundle/Code.gs` → Apps Script'dagi `Код.gs` ga (Cmd+A → Delete → Cmd+V → Cmd+S)

### 2. Havolani ochiq qiling

**Начать развертывание → Управление развертываниями → ✏️**

| Maydon | Yangi qiymat |
|---|---|
| **У кого есть доступ** | `Все` *(oldin: Все пользователи с аккаунтом Google)* |
| **Версия** | `Новая версия` |

→ **Развернуть**

> **Nega kerak.** Boshqa domendagi sahifa Google hisobi talab qiladigan manzilga
> so'rov yubora olmaydi — brauzer uni to'xtatadi.
>
> **Xavfsizlik.** Havolani bilgan odam sahifani ocha oladi, lekin **ma'lumotga yeta olmaydi**:
> har bir so'rov email va parol bilan olingan imzolangan token talab qiladi
> (HMAC-SHA256), parollar esa 600 marta xeshlangan holda saqlanadi.
> Tokensiz so'rovga faqat "Tizimga kiring" javobi qaytadi.

### 3. GitHub'ga joylang

1. [github.com/signup](https://github.com/signup) — hisob oching (bepul)
2. [github.com/new](https://github.com/new) — yangi repozitoriy:
   - **Repository name:** `ovqat-skaner`
   - **Public** ni tanlang *(Pages bepul rejada faqat public uchun ishlaydi)*
   - **Create repository**
3. Ochilgan sahifada **uploading an existing file** havolasini bosing
4. `skaner` papkasidagi **7 ta faylni** (papkani emas, ichidagi fayllarni) sudrab tashlang
5. Pastda **Commit changes**
6. **Settings** → chapdan **Pages** → *Build and deployment*:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main` / `/ (root)` → **Save**
7. 1–2 daqiqa kuting, sahifa yuqorida havolani ko'rsatadi:

```
https://SIZNING-NOMINGIZ.github.io/ovqat-skaner/
```

### 4. Telefonda ulang

1. Havolani telefonda oching
2. Uch maydonni to'ldiring:
   - **Tizim havolasi** — Apps Script `.../exec` manzili
   - **Elektron pochta** va **parol** — "Ovqat tarqatish" bo'limiga dostupi bor foydalanuvchi
3. **Ulash** → kameraga ruxsat bering
4. Telefon menyusidan **«Ekranga qo'shish»** / **«Добавить на главный экран»**

Bu ma'lumotlar qurilmada saqlanadi — keyingi safar to'g'ridan-to'g'ri skaner ochiladi.

---

## Ishlash tartibi

- Ochilganda o'quvchilar ro'yxati yuklab olinadi va qurilmada saqlanadi
- Qaror (yashil / qizil) qurilmada chiqadi — serverga so'rov yuborilmaydi, shuning uchun tez
- **Saqlash** bosilganda yozuv navbatga tushadi va darhol yuborishga urinadi
- Internet yo'q bo'lsa navbatda kutadi; yuqorida `aloqa yo'q · navbatda: 5` ko'rinadi
- Aloqa tiklanishi bilan o'zi yuboriladi (har 15 soniyada urinadi)
- Ro'yxat har 5 daqiqada yangilanadi — yangi o'quvchilar va status o'zgarishlari tushadi
- Skanerlash paytida ekran o'chmaydi (Wake Lock)

### Qizil ekranlar

| Holat | Yozuv |
|---|---|
| Shu QR bugun ikkinchi marta | Bu o'quvchi ovqat olgan |
| Kod tizimda yo'q | Bu QR kod tizimda mavjud emas |
| Status "nofaol" | Bu o'quvchi to'lov qilmagan yoki limit tugagan |

Har uchalasida ham **Saqlash** bor — urinish tarixga yoziladi.

---

## Yangilash

Kodni o'zgartirsangiz, fayllarni GitHub'ga qayta yuklang va `sw.js` dagi
`CACHE = 'ovqat-skaner-v1'` raqamini oshiring (`v2`, `v3`…) — shunda telefonlardagi
eski nusxa yangilanadi.

---

## Muammolar

| Belgi | Sabab |
|---|---|
| "Kamera ochilmadi (NotAllowedError)" | Brauzer sozlamalarida saytga kamera ruxsatini bering |
| "Failed to fetch" / ulanmayapti | Apps Script havolasi `Все` ga o'tkazilmagan (2-qadam) |
| "Bu foydalanuvchida dostup yo'q" | Operatsion ishlar bo'limida unga "Ovqat tarqatish" oynasini bering |
| Sahifa oq | `jsQR.js` yuklanmagan — 7 ta fayl ham yuklanganini tekshiring |
