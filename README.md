# TableSpot -Smart Cafe Table Occupancy Display

**Tema proyek:** Smart Cafe Table Occupancy Display

**Mata kuliah:** Praktikum Internet of Things (IoT), Informatika UPN "Veteran" Yogyakarta, Semester Gasal 2026/2027

**Anggota Kelompok:**
| Nama | NIM | 
|---|---|
| Muhammad Rifty Alfattah | 123240093 |
| Muhamad Atallah Alfa Dzaky | 123240105 |
| Munadhil Mutawakkil | 123240154 |

## Deskripsi Singkat

TableSpot adalah sistem IoT untuk memantau ketersediaan meja dan kursi di sebuah kafe secara real-time. Sensor ultrasonik HC-SR04 di setiap kursi mendeteksi apakah kursi sedang diduduki. ESP32 mengirim hasilnya lewat MQTT ke sebuah bridge Python, lalu bridge meneruskannya ke Firebase Realtime Database. Pengunjung bisa melihat denah meja dari mana saja lewat dashboard web, sedangkan staf yang login bisa melihat statistik pemakaian dan peringatan jika sensor atau sistem bermasalah. Status meja juga tampil langsung di kafe lewat LED merah/hijau dan LCD 16x2.

Prototipe berupa miniatur kafe dengan **5 meja dan 7 kursi**:

| Meja | Kursi | Sensor |
|---|---|---|
| M1 | K1, K2 | Sensor 1, 2 |
| M2 | K3, K4 | Sensor 3, 4 |
| M3 | K5 | Sensor 5 |
| M4 | K6 | Sensor 6 |
| M5 | K7 | Sensor 7 |

Sebuah meja dianggap terisi jika salah satu kursinya terisi. Contoh: jika K1 terisi maka K1 dan M1 berwarna merah, sedangkan K2 tetap hijau.

Batasan: sistem hanya menampilkan ketersediaan, tidak menerima reservasi dan tidak menerima pemesanan menu.

---

## Arsitektur Sistem

```
HC-SR04 x7 -> ESP32 -> (WiFi, MQTT) -> Mosquitto -> Bridge Python -> Firebase Realtime DB -> Dashboard Web
                 |                                                         ^
                 +-> 74HC595 x2 -> LED merah/hijau per meja                |
                 +-> LCD I2C 16x2                          stats_engine.py (statistik)
```

| Lapisan | Komponen |
|---|---|
| Perangkat (sensing) | ESP32, 7 sensor HC-SR04 |
| Indikator lokal | 2 IC 74HC595, 10 LED merah/hijau, LCD I2C 16x2 |
| Komunikasi | WiFi, MQTT (broker Mosquitto, topik `esp32/sensor`) |
| Pengolahan data | Bridge Python di komputer kafe (`paho-mqtt`, `firebase-admin`) |
| Cloud | Firebase Realtime Database, Authentication, dan Hosting |
| Aplikasi | Dashboard web (HTML, CSS, JavaScript, tanpa build step) |

---

## Komponen

**Perangkat keras:** ESP32, 7x sensor ultrasonik HC-SR04, 2x IC 74HC595 (shift register), 5 pasang LED merah-hijau (10 LED), LCD I2C 16x2 (alamat 0x27), komputer kafe yang menjalankan broker dan bridge.

**Perangkat lunak dan pustaka:**

| Bagian | Teknologi |
|---|---|
| Firmware | Arduino IDE, `WiFi`, `PubSubClient`, `ArduinoJson`, `LiquidCrystal_I2C`, `Wire` |
| Broker | Eclipse Mosquitto |
| Bridge | Python 3, `paho-mqtt`, `firebase-admin` |
| Dashboard | HTML, CSS, JavaScript (ES module), Firebase Web SDK 10.12.2 via CDN |
| Cloud | Firebase Realtime Database, Authentication (Email/Password), Hosting |

---

## Struktur Repositori

```
TableSpot/
├── README.md
├── requirements.txt
├── firebase.json                # konfigurasi Firebase Hosting
├── .firebaserc                  # proyek Firebase yang dipakai
├── .gitignore
├── MonitorMeja/
│   └── MonitorMeja.ino          # program ESP32 (sensor, LED, LCD, MQTT)
├── BridgePython/
│   ├── bridgeProgram.py                # bridge MQTT -> Firebase (program utama)
│   └── statisticEngine.py              # penghitung statistik pemakaian harian
└── public/
    ├── index.html                   # halaman tunggal (SPA)
    ├── style.css                    # semua gaya antarmuka
    ├── app.js                       # logika utama (ES module)
    ├── firebase-config.example.js   # contoh format konfigurasi
    └── firebase-config.js           # konfigurasi asli (BUAT SENDIRI, tidak di-commit)
```

---

## Prasyarat

- Proyek Firebase yang aktif dengan:
  - **Realtime Database** diaktifkan
  - **Authentication** diaktifkan (provider Email/Password)
  - Minimal satu akun pengguna untuk login sebagai staf
- Python 3 (untuk bridge, statistik, dan menjalankan dashboard secara lokal)
- Arduino IDE dengan dukungan board ESP32
- Mosquitto terpasang di komputer kafe
- Browser modern (Chrome, Firefox, Edge, Safari terkini)
- Firebase CLI (hanya jika ingin deploy dashboard)

---

## Langkah 1 - Persiapan Firebase

1. Buka [Firebase Console](https://console.firebase.google.com), buat proyek baru atau pilih proyek yang ada.
2. Aktifkan **Realtime Database**, **Authentication** (Email/Password), dan **Hosting**.
3. Di Authentication, tab Users, buat minimal satu akun staf. Akun ini dipakai untuk login ke tab Statistik.
4. Atur **aturan keamanan Realtime Database**. Pastikan database mengizinkan **baca publik** untuk path yang dibutuhkan denah dan **menolak semua penulisan dari klien**. Contoh minimal:

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

   Catatan: path `stats/` dibatasi hanya untuk pengguna yang sudah login (staf). Path lain seperti `history/` tidak bisa dibaca klien. Bridge menulis lewat Admin SDK (service account) sehingga tidak terpengaruh rules ini.

5. Buat kunci service account untuk bridge: Project settings, tab Service accounts, **Generate new private key**. Simpan file hasil unduhan sebagai `bridge/serviceAccount2.json`. File ini rahasia dan tidak boleh di-commit.

---

## Langkah 2 - Broker MQTT (Mosquitto)

Pasang Mosquitto di komputer kafe (komputer yang sama dengan yang akan menjalankan bridge). Agar ESP32 di jaringan WiFi yang sama bisa terhubung, tambahkan pada `mosquitto.conf`:

```
listener 1883
allow_anonymous true
```

Pengaturan ini hanya untuk jaringan lokal dan tidak boleh diekspos ke internet. Setelah itu jalankan ulang Mosquitto dan catat alamat IP komputer tersebut (dipakai di firmware dan bridge).

---

## Langkah 3 - Firmware ESP32

1. Buka `firmware/MonitorMeja/MonitorMeja.ino` di Arduino IDE.
2. Ubah tiga nilai di bagian atas program:
   - `ssid`: nama WiFi
   - `password`: kata sandi WiFi
   - `mqtt_server`: alamat IP komputer yang menjalankan Mosquitto
3. Pasang library lewat Library Manager: `PubSubClient`, `ArduinoJson`, `LiquidCrystal_I2C`.
4. Pilih board ESP32 yang sesuai, lalu unggah program.
5. Buka Serial Monitor (115200 baud). Program mencetak jarak tiap kursi dan status koneksi WiFi/MQTT.

### Konfigurasi pin

| Fungsi | Pin |
|---|---|
| TRIG (7 sensor digabung) | 13 |
| ECHO sensor 1 sampai 7 | 6, 7, 10, 14, 16, 17, 18 |
| 74HC595 DATA | 4 |
| 74HC595 CLOCK | 5 |
| 74HC595 LATCH | 15 |
| LCD I2C SDA / SCL (alamat 0x27) | 8 / 9 |

### Pemetaan LED pada shift register

| Meja | LED merah (terisi) | LED hijau (kosong) |
|---|---|---|
| M1 | IC1 Q1 | IC1 Q2 |
| M2 | IC1 Q3 | IC1 Q4 |
| M3 | IC1 Q5 | IC2 Q1 |
| M4 | IC2 Q2 | IC2 Q3 |
| M5 | IC2 Q4 | IC2 Q5 |

Q0 pada kedua IC tidak dipakai.

### Cara kerja firmware

1. Tiap sensor dibaca 5 kali, lalu diambil **median** jaraknya (dalam cm). Jika kelima pembacaan gagal (tidak ada echo), sensor ditandai error (`-1`).
2. Kursi dianggap **terisi** jika jarak 20 cm atau kurang (`THRESHOLD_DIST`), dan **kosong** jika lebih jauh.
3. Status meja ditentukan dari kursinya: meja kosong hanya jika semua kursinya kosong, dan meja error jika salah satu sensornya error.
4. LED merah/hijau per meja dinyalakan lewat 2 IC 74HC595.
5. LCD menampilkan status tiap meja dengan kode `K` (kosong), `T` (terisi), `E` (error), beserta jumlah meja kosong dan terisi.
6. Data dikirim ke broker pada topik `esp32/sensor` sekitar tiap 1 detik, dalam format JSON:

   ```json
   {
     "kursi": [1, 0, 1, 1, 0, 1, 1],
     "meja":  [0, 1, 0, 1, 1],
     "ts": 123456
   }
   ```

   Nilai `1` berarti kosong, `0` terisi, dan `-1` error. `ts` adalah `millis()` ESP32.
7. ESP32 juga berlangganan topik `esp32/command` dan dapat memperbarui baris pertama LCD jika menerima pesan berisi `lcd_line1`.

---

## Langkah 4 - Bridge Python

Bridge berjalan di komputer kafe. Tugasnya menerima data dari ESP32 lewat MQTT, menerjemahkannya ke ID kursi/meja dashboard, lalu menulisnya ke Firebase.

```bash
cd bridge
pip install -r requirements.txt
```

Buka `bridge2.py` dan sesuaikan bagian konfigurasi:

| Konstanta | Isi |
|---|---|
| `MQTT_BROKER` | alamat IP komputer yang menjalankan Mosquitto |
| `MQTT_PORT` | port broker, default `1883` |
| `TOPIC_SENSOR` | topik data sensor, default `esp32/sensor` |
| `FIREBASE_CRED` | nama file kunci service account, default `serviceAccount2.json` |
| `FIREBASE_URL` | URL Realtime Database proyek Firebase |

Pastikan `serviceAccount2.json` berada di folder `bridge/`, lalu jalankan:

```bash
python bridge2.py
```

Ketika dijalankan, bridge:

1. Menandai semua kursi dan meja `offline` di Firebase, lalu menunggu data pertama dari ESP32.
2. Memetakan array `kursi` dari ESP32 ke ID dashboard: indeks 0 sampai 6 menjadi K1 (M1), K2 (M1), K3 (M2), K4 (M2), K5 (M3), K6 (M4), K7 (M5).
3. Menulis status kursi ke `seats/` dan status meja ke `tables/`, lengkap dengan waktu perubahan (`since`).
4. Memperbarui `system/beat` (maksimal 1 kali per detik) sebagai tanda bahwa bridge masih hidup.
5. Mencatat setiap perubahan status kursi ke `history/<tanggal>/` untuk bahan statistik.
6. Menandai semua kursi dan meja `offline` jika tidak ada data dari ESP32 selama lebih dari 30 detik.

### Statistik pemakaian

`stats_engine.py` membaca log `history/` hari ini, menghitung jumlah giliran dan lama pemakaian, lalu menulis hasilnya ke `stats/` di Firebase. Skrip ini dijalankan manual:

```bash
python stats_engine.py
```

Konfigurasi `FIREBASE_CRED` dan `FIREBASE_URL` di dalamnya sama dengan di `bridge2.py`.

---

## Langkah 5 - Dashboard Web

### 5a. Isi konfigurasi Firebase

1. Buka [Firebase Console](https://console.firebase.google.com), pilih proyek.
2. Klik ikon roda gigi, **Setelan proyek**, tab **Umum**.
3. Gulir ke bagian **Aplikasi web Anda** dan salin nilai konfigurasinya.
4. Di folder `dashboard/public/`, salin `firebase-config.example.js` menjadi `firebase-config.js`, lalu ganti nilai placeholder:

   ```js
   export const firebaseConfig = {
     apiKey:      "GANTI_DENGAN_API_KEY_ANDA",
     authDomain:  "nama-proyek.firebaseapp.com",
     databaseURL: "https://nama-proyek-default-rtdb.asia-southeast1.firebasedatabase.app",
     projectId:   "nama-proyek",
     appId:       "1:123456789:web:abc123",
   };
   ```

> **Jangan commit** `firebase-config.js` ke repositori publik. File ini sudah masuk `.gitignore`. Gunakan `firebase-config.example.js` sebagai referensi format.

### 5b. Menjalankan lokal

Gunakan server HTTP lokal agar ES module (`type="module"`) dan `import` berfungsi. **Jangan buka `index.html` langsung via `file://`** karena browser memblokir ES module dari filesystem.

Cara termudah dengan Python:

```bash
cd dashboard/public
python -m http.server 8080
```

Buka browser dan akses `http://localhost:8080`.

Alternatif dengan Node.js:

```bash
npx serve dashboard/public -p 8080
```

### 5c. Deploy ke Firebase Hosting

Pastikan [Firebase CLI](https://firebase.google.com/docs/cli) sudah terinstal.

**Login (sekali saja):**

```bash
firebase login
```

**Inisialisasi proyek (hanya jika belum ada `.firebaserc`):**

```bash
cd dashboard
firebase init hosting
```

Saat ditanya:
- **Project**: pilih proyek Firebase Anda
- **Public directory**: ketik `public`
- **Configure as single-page app**: `Yes`
- **Set up automatic builds**: `No`
- **Overwrite `public/index.html`**: `No` (jangan timpa)

**Deploy:**

```bash
firebase deploy --only hosting
```

URL live akan tampil setelah proses selesai.

---

## Alur Data dan Struktur Database

```
ESP32 --(MQTT: esp32/sensor)--> Mosquitto --> bridge2.py --(Admin SDK)--> Firebase RTDB
                                                                              |
                                                       Dashboard (hanya membaca, onValue)
```

Dashboard **hanya membaca** dari Firebase dan tidak pernah menulis.

| Path Firebase | Ditulis oleh | Isi |
|---|---|---|
| `seats/<K1..K7>` | `bridge2.py` | `{ table, status, since }`, status: `available`, `occupied`, `offline` |
| `tables/<M1..M5>` | `bridge2.py` | `{ status, since }`, status: `available`, `occupied`, `offline` |
| `system/beat` | `bridge2.py` | waktu (epoch ms) terakhir bridge menerima data ESP32 |
| `history/<YYYY-MM-DD>/<id>` | `bridge2.py` | log perubahan status kursi: `{ tipe, id, meja, status, ts }` |
| `stats/hari_ini` | `stats_engine.py` | `{ giliran, rata_lama_menit, puncak_jam }` |
| `stats/meja/<M1..M5>` | `stats_engine.py` | `{ giliran, rata_lama_menit, persen_terisi }` |
| `stats/updated` | `stats_engine.py` | waktu (epoch ms) statistik terakhir dihitung |

---

## Fitur Dashboard

| Tab | Akses | Fitur |
|---|---|---|
| Denah | Publik (tanpa login) | Kartu meja real-time, status kursi, ringkasan kosong/terisi, banner "sistem tidak terhubung" |
| Statistik | Staf (login email dan password) | Kartu ringkasan, tabel pemakaian per meja, panel peringatan |

Indikator di kafe: LED merah/hijau per meja dan LCD ringkasan status.

---

## Mengubah Tata Letak Denah

Tata letak denah didefinisikan oleh konstanta `LAYOUT` di bagian atas `dashboard/public/app.js`, bukan di HTML maupun CSS. Anda tidak perlu menyentuh logika render sama sekali.

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
| Ganti nama tampilan meja/kursi | Jangan: `mejaId` dan `kursi` **harus** sesuai dengan path di Firebase (`tables/<mejaId>`, `seats/<kursiId>`) |

Setelah disimpan dan halaman di-refresh, denah akan langsung menampilkan susunan baru.

---

## Aturan Peringatan

Panel **Peringatan** muncul di bagian atas tab Statistik, hanya setelah staf login. Peringatan dihitung di sisi dashboard dari data yang sudah dibaca, tidak ada penulisan ke Firebase.

### Tiga kondisi peringatan

| # | Kondisi | Pesan yang ditampilkan |
|---|---------|----------------------|
| (a) | `system/beat` tidak berubah lebih dari 30 detik | "Sistem di kafe tidak terhubung (bridge atau komputer kafe berhenti). Data yang tampil mungkin tidak terbaru." |
| (b) | Beat masih berjalan, tetapi **semua** kursi berstatus `offline` | "Perangkat sensor (ESP32) tidak mengirim data. Periksa daya dan WiFi." |
| (c) | Beat masih berjalan, hanya **sebagian** kursi `offline` | Satu peringatan per kursi: "Sensor kursi K3 (Meja M2) tidak mengirim data. Periksa kabel dan posisi sensor." |

### Prioritas

Jika kondisi **(a)** aktif, peringatan **(b)** dan **(c)** tidak ditampilkan, karena data tidak dapat dipercaya saat sistem offline.

### Hal yang perlu diketahui

- Peringatan **hilang otomatis** saat kondisi pulih (tidak ada riwayat disimpan).
- Peringatan hanya tampil **saat dashboard terbuka** dan staf sudah login. Tidak ada notifikasi push.
- Lencana angka merah muncul di tombol tab **Statistik** saat ada peringatan aktif.
- Judul jendela browser akan diawali `(!)` saat ada peringatan.
- Tab **Denah** (publik) hanya menampilkan banner "sistem tidak terhubung" untuk kondisi (a); rincian per sensor tidak ditampilkan ke publik.
- Peringatan (b) dan (c) muncul bila status `offline` untuk kursi tertulis di Firebase.

---

## Keamanan dan File yang Tidak Diunggah

Repositori ini **tidak berisi** kata sandi, token, API key, atau kredensial pribadi. File berikut dibuat sendiri oleh pengguna dan tidak boleh di-commit (sudah masuk `.gitignore`):

| File | Isi | Cara membuat |
|---|---|---|
| `bridge/serviceAccount2.json` | kunci service account Firebase (rahasia) | Langkah 1, nomor 5 |
| `dashboard/public/firebase-config.js` | konfigurasi aplikasi web Firebase | Langkah 5a |

Isi `.gitignore` yang disarankan:

```
serviceAccount*.json
*-firebase-adminsdk-*.json
*.json.key
firebase-config.js
.env
env/
__pycache__/
.firebase/
node_modules/
```

Di firmware, `ssid`, `password`, dan `mqtt_server` pada `MonitorMeja.ino` hanya berisi nilai contoh; isi dengan nilai jaringan masing-masing sebelum diunggah ke ESP32 dan jangan commit nilai aslinya.

Keamanan data di sisi cloud diatur oleh rules Realtime Database (lihat Langkah 1): pengunjung hanya bisa membaca, dan statistik hanya bisa dibaca staf yang login.

---

## Troubleshooting

| Masalah | Kemungkinan penyebab | Solusi |
|---------|---------------------|--------|
| Halaman putih / error di konsol | `firebase-config.js` belum dibuat atau belum diisi | Salin dari file contoh dan isi dengan konfigurasi Firebase Anda |
| Halaman putih saat membuka `index.html` langsung | Dibuka via `file://`, ES module diblokir | Jalankan lewat server lokal (Langkah 5b) |
| "Akses ditolak" | Aturan keamanan database terlalu ketat | Periksa rules di Firebase Console |
| Statistik kosong | `stats_engine.py` belum dijalankan, atau belum ada log di `history/` | Pastikan bridge berjalan lalu jalankan `python stats_engine.py` |
| "Sistem tidak terhubung" | Bridge Python mati / `system/beat` berhenti berubah | Pastikan `bridge2.py` berjalan di komputer kafe |
| Bridge tidak menerima data | IP broker salah, firewall memblokir port 1883, atau Mosquitto belum mengizinkan koneksi dari luar | Cek `MQTT_BROKER`, `mqtt_server` di `.ino`, dan `mosquitto.conf` |
| ESP32 gagal terhubung MQTT | ESP32 dan komputer tidak di jaringan yang sama | Hubungkan keduanya ke WiFi yang sama, cek Serial Monitor |
| Bridge error saat dijalankan | Dependensi belum terpasang atau `serviceAccount2.json` tidak ada | `pip install -r requirements.txt` dan letakkan kunci di folder `bridge/` |
| Login gagal | Email/password salah atau akun belum dibuat | Buat akun di Firebase Console, Authentication, Users |
| LCD kosong | Alamat I2C atau pin SDA/SCL tidak sesuai | Cek alamat (0x27) dan pin SDA 8 / SCL 9 |
| Sensor selalu terbaca error | Kabel TRIG/ECHO longgar | Periksa kabel dan pin sesuai tabel konfigurasi pin |

---

## Tautan Hasil Akhir

- Video demonstrasi: _(isi tautan YouTube)_
- Artikel Medium: _(isi tautan Medium)_
- Dashboard: https://tablespot-cafe.web.app

---

*Proyek Akhir Praktikum IoT, Semester Gasal 2026/2027, Informatika.*
