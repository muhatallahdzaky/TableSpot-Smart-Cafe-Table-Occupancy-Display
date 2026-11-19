# Tablespot Dashboard

Dashboard web untuk monitoring ketersediaan kursi dan meja kafe secara real-time, menggunakan Firebase Realtime Database.

---

## Prasyarat

- Proyek Firebase yang sudah aktif dengan:
  - **Realtime Database** diaktifkan
  - **Authentication** diaktifkan (Email/Password provider)
  - Minimal satu akun pengguna untuk login sebagai staf
- Browser modern (Chrome, Firefox, Edge, Safari terkini)
- Python 3 (untuk menjalankan lokal) **atau** Firebase CLI (untuk deploy)

---

## Langkah 1 — Isi Konfigurasi Firebase

1. Buka [Firebase Console](https://console.firebase.google.com) → pilih proyek Anda.
2. Klik ikon roda gigi ⚙ → **Setelan proyek** → tab **Umum**.
3. Gulir ke bawah ke bagian **Aplikasi web Anda** → salin nilai konfigurasi.
4. Buka file `public/firebase-config.js` dan ganti nilai placeholder:

```js
export const firebaseConfig = {
  apiKey:      "GANTI_DENGAN_API_KEY_ANDA",
  authDomain:  "nama-proyek.firebaseapp.com",
  databaseURL: "https://nama-proyek-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:   "nama-proyek",
  appId:       "1:123456789:web:abc123",
};
```

> ⚠ **Jangan commit** `firebase-config.js` ke repositori publik.
> File ini sudah tercantum di `.gitignore` sebaiknya. Gunakan `firebase-config.example.js` sebagai referensi format.

---

## Langkah 2 — Aturan Keamanan Firebase Realtime Database

Pastikan aturan Realtime Database mengizinkan **baca publik** untuk path yang dibutuhkan dashboard dan **menolak semua penulisan**. Contoh minimal:

```json
{
  "rules": {
    "tables":  { ".read": true,  ".write": false },
    "seats":   { ".read": true,  ".write": false },
    "system":  { ".read": true,  ".write": false },
    "stats": {
      ".read": "auth != null",
      ".write": false
    },
    "$other":  { ".read": false, ".write": false }
  }
}
```

> Catatan: path `stats/` dibatasi hanya untuk pengguna yang sudah login (staf).

---

## Langkah 3 — Menjalankan Lokal

Gunakan server HTTP lokal agar ES module (`type="module"`) dan `import` berfungsi dengan benar. **Jangan buka `index.html` langsung via `file://`** karena browser akan memblokir ES module dari filesystem.

### Cara termudah: Python

```bash
cd public
python -m http.server 8080
```

Buka browser dan akses: **http://localhost:8080**

### Alternatif: Node.js `npx serve`

```bash
npx serve public -p 8080
```

---

## Langkah 4 — Deploy ke Firebase Hosting

> Pastikan [Firebase CLI](https://firebase.google.com/docs/cli) sudah terinstal.

### 4a. Login ke Firebase (lakukan sekali)

```bash
firebase login
```

### 4b. Inisialisasi proyek (lakukan sekali jika belum ada `.firebaserc`)

```bash
firebase init hosting
```

Saat ditanya:
- **Project**: pilih proyek Firebase Anda
- **Public directory**: ketik `public`
- **Configure as single-page app**: `Yes`
- **Set up automatic builds**: `No`
- **Overwrite `public/index.html`**: `No` (jangan timpa!)

### 4c. Deploy

```bash
firebase deploy --only hosting
```

URL live akan tampil setelah proses selesai.

---

## Struktur File

```
TableSpot Dashboard/
├── firebase.json               ← Konfigurasi Firebase Hosting
├── README.md                   ← Dokumen ini
└── public/
    ├── index.html              ← Halaman tunggal (SPA)
    ├── style.css               ← Semua gaya antarmuka
    ├── app.js                  ← Logika utama (ES module)
    ├── firebase-config.js      ← Konfigurasi Firebase (ISI SENDIRI, jangan di-commit)
    └── firebase-config.example.js  ← Contoh format konfigurasi
```

---

## Fitur Utama

| Tab | Akses | Fitur |
|-----|-------|-------|
| Denah | Publik (tanpa login) | Kartu meja real-time, status kursi, ringkasan kosong/terisi, banner offline |
| Statistik | Staf (login email+password) | Grafik okupansi per jam, kartu ringkasan, tabel pemakaian per meja |

---

## Troubleshooting

| Masalah | Kemungkinan Penyebab | Solusi |
|---------|---------------------|--------|
| Halaman putih / error di konsol | `firebase-config.js` belum diisi | Isi dengan konfigurasi Firebase Anda |
| "Akses ditolak" | Aturan keamanan database terlalu ketat | Periksa rules di Firebase Console |
| Grafik tidak muncul | Data `stats/jam` belum ada | Bridge perlu berjalan minimal beberapa jam untuk mengumpulkan data |
| "Sistem tidak terhubung" | Bridge Python mati / `system/beat` berhenti berubah | Pastikan bridge berjalan di sisi server |
| Login gagal | Email/password salah atau akun belum dibuat | Buat akun di Firebase Console → Authentication → Users |

---

## Mengubah Tata Letak Denah

Tata letak denah didefinisikan oleh konstanta `LAYOUT` di bagian atas [`public/app.js`](public/app.js), bukan di HTML maupun CSS. Anda tidak perlu menyentuh logika render sama sekali.

### Struktur LAYOUT

```js
const LAYOUT = [
  // Setiap elemen array = satu baris di denah
  // Baris pertama = paling jauh dari pintu masuk
  [
    { mejaId: "M1", kursi: ["K1", "K2"] },
    { mejaId: "M2", kursi: ["K3", "K4"] },
  ],
  // Baris kedua = paling dekat pintu masuk
  [
    { mejaId: "M3", kursi: ["K5"] },
    { mejaId: "M4", kursi: ["K6"] },
    { mejaId: "M5", kursi: ["K7"] },
  ],
];
```

### Cara mengubah

| Yang ingin diubah | Caranya |
|---|---|
| Pindahkan meja ke baris lain | Pindahkan objek `{ mejaId, kursi }` ke array baris lain |
| Tambahkan baris baru | Tambahkan `[ ... ]` baru di dalam `LAYOUT` |
| Ubah meja mana yang punya kursi apa | Edit array `kursi` pada objek yang sesuai |
| Ganti nama tampilan meja/kursi | Jangan — `mejaId` dan `kursi` **harus** sesuai dengan path di Firebase (`tables/<mejaId>`, `seats/<kursiId>`) |

Setelah disimpan dan halaman di-refresh, denah akan langsung menampilkan susunan baru.

---

## Aturan Peringatan

Panel **Peringatan** muncul di bagian atas tab Statistik, hanya setelah staf login. Peringatan dihitung di sisi dashboard dari data yang sudah dibaca — tidak ada penulisan ke Firebase.

### Tiga kondisi peringatan

| # | Kondisi | Pesan yang ditampilkan |
|---|---------|----------------------|
| (a) | `system/beat` tidak berubah lebih dari 30 detik | "Sistem di kafe tidak terhubung (bridge atau komputer kafe berhenti). Data yang tampil mungkin tidak terbaru." |
| (b) | Beat masih berjalan, tetapi **semua** kursi berstatus `offline` | "Perangkat sensor (ESP32) tidak mengirim data. Periksa daya dan WiFi." |
| (c) | Beat masih berjalan, hanya **sebagian** kursi `offline` | Satu peringatan per kursi: "Sensor kursi K3 (Meja M2) tidak mengirim data. Periksa kabel dan posisi sensor." |

### Prioritas

Jika kondisi **(a)** aktif, peringatan **(b)** dan **(c)** tidak ditampilkan — data tidak dapat dipercaya saat sistem offline.

### Hal yang perlu diketahui

- Peringatan **hilang otomatis** saat kondisi pulih (tidak ada riwayat disimpan).
- Peringatan hanya tampil **saat dashboard terbuka** dan staf sudah login — tidak ada notifikasi push.
- Lencana angka merah muncul di tombol tab **Statistik** saat ada peringatan aktif.
- Judul jendela browser akan diawali `(!)` saat ada peringatan.
- Tab **Denah** (publik) hanya menampilkan banner "sistem tidak terhubung" untuk kondisi (a); rincian per sensor tidak ditampilkan ke publik.

---

*Proyek Akhir Semester — Informatika*
