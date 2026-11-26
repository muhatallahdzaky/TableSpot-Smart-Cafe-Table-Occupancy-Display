/**
 * app.js — Tablespot Dashboard (Revisi 2)
 *
 * Arsitektur:
 *   - firebase-config.js    : konfigurasi Firebase (diisi pengguna)
 *   - LAYOUT / MEJA_CONFIG  : konstanta tata letak denah — ubah di sini tanpa menyentuh logika
 *   - Data layer            : fungsi-fungsi yang membaca Firebase & memperbarui state
 *   - Logic layer           : hitung peringatan, ringkasan, format waktu
 *   - Render layer          : fungsi-fungsi yang menulis ke DOM berdasarkan state
 *   - Controller            : menghubungkan data layer ke render layer, auth, event UI
 *
 * Firebase SDK dimuat via CDN (ES module). Tidak ada npm, tidak ada build step.
 * HANYA MEMBACA dari Firebase. Tidak ada penulisan sama sekali.
 */

// ============================================================
// Import Firebase SDK (modular, CDN gstatic versi dipin)
// ============================================================
import { initializeApp }                        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue }            from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
}                                               from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig }                       from "./firebase-config.js";

// ============================================================
// LAYOUT — tata letak denah bioskop
// Ubah konstanta ini untuk menyesuaikan susunan meja di kafe.
// Setiap baris berisi array objek { mejaId, kursi[] }.
// ============================================================

/**
 * LAYOUT mendeskripsikan susunan fisik meja dalam denah.
 * Baris pertama = bagian paling jauh dari pintu masuk.
 * Baris terakhir = paling dekat pintu masuk.
 *
 * Untuk mengubah tata letak:
 *   1. Susun ulang objek di dalam array baris.
 *   2. Tambah/hapus baris dengan menambah/hapus array dalam LAYOUT.
 *   3. Jangan ubah id meja / kursi — harus sesuai dengan data Firebase.
 */
const LAYOUT = [
  { mejaId: "M3", kursi: ["K5"] },
  { mejaId: "M4", kursi: ["K6"] },
  { mejaId: "M5", kursi: ["K7"] },
  { mejaId: "M2", kursi: ["K3", "K4"] },
  { mejaId: "M1", kursi: ["K1", "K2"] },
];
const DENAH_GRID = [
  [{ type: "meja", id: "M3" }, { type: "meja", id: "M4" }, { type: "meja", id: "M5" }],
  [{ type: "kursi", id: "K5" }, { type: "kursi", id: "K6" }, { type: "kursi", id: "K7" }],
  [{ type: "jalan", label: "JALAN" }],
  [{ type: "kursi", id: "K3" }, null, { type: "kursi", id: "K1" }],
  [{ type: "meja", id: "M2" }, null, { type: "meja", id: "M1" }],
  [{ type: "kursi", id: "K4" }, null, { type: "kursi", id: "K2" }],
];

/** Daftar meja datar — dipakai oleh fungsi-fungsi lain */
const MEJA_CONFIG = LAYOUT.flat();

/** Jam operasional yang dilacak statistiknya */
const JAM_RANGE = Array.from({ length: 15 }, (_, i) => String(i + 8).padStart(2, "0")); // "08".."22"

/** Semua id kursi yang dikenal */
const SEMUA_KURSI = MEJA_CONFIG.flatMap(m => m.kursi);

/** Semua id meja yang dikenal */
const SEMUA_MEJA = MEJA_CONFIG.map(m => m.mejaId);

// ============================================================
// State global (diisi oleh data layer, dibaca oleh render layer)
// ============================================================

const state = {
  // Denah
  tables: {},            // { M1: {status, since}, ... }
  seats:  {},            // { K1: {table, status, since}, ... }
  beatLastChanged: null, // Date.now() saat nilai beat terakhir berubah
  beatValue: null,       // nilai beat terakhir
  beatOfflineTimer: null,// id setInterval pengecekan offline
  sistemOffline: false,  // true jika beat >30 detik tidak berubah

  // Statistik
  statsJamKerja:      {},  // { "08": 0.5, ... }
  statsJamAkhirPekan: {},  // { "08": 0.3, ... }
  statsJamTersibuk:   {},  // { kerja: "14", akhir_pekan: "15" }
  statsHariIni:       {},  // { giliran, puncak_terisi, puncak_jam, rata_lama_menit }
  statsMeja:          {},  // { M1: {giliran, rata_lama_menit, persen_terisi}, ... }
  statsUpdated:       null,// milidetik

  // Auth
  currentUser: null,

  // Tooltip denah (id elemen yang sedang menampilkan keterangan)
  denahTooltipTarget: null,
};

// ============================================================
// Inisialisasi Firebase
// ============================================================

let app, db, auth;

try {
  app  = initializeApp(firebaseConfig);
  db   = getDatabase(app);
  auth = getAuth(app);
} catch (err) {
  renderFatalError(
    "Gagal menghubungkan ke Firebase",
    "Pastikan firebase-config.js sudah diisi dengan benar. Error: " + err.message
  );
  throw err;
}

// ============================================================
// Utilitas
// ============================================================

/**
 * Format waktu relatif dari timestamp (milidetik) ke string
 * seperti "baru saja", "5 menit lalu", "2 jam lalu", dst.
 * @param {number|null} since - epoch ms
 * @returns {string}
 */
function formatRelative(since) {
  if (!since) return "—";
  const diff = Math.floor((Date.now() - since) / 1000);
  if (diff < 10)   return "baru saja";
  if (diff < 60)   return `${diff} detik lalu`;
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} menit lalu`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} jam lalu`;
  }
  const d = Math.floor(diff / 86400);
  return `${d} hari lalu`;
}

/**
 * Kembalikan label teks status dalam Bahasa Indonesia.
 * @param {"available"|"occupied"|"offline"|string} status
 * @returns {string}
 */
function labelStatus(status) {
  switch (status) {
    case "available": return "Kosong";
    case "occupied":  return "Terisi";
    case "offline":   return "Offline";
    default:          return "—";
  }
}

/**
 * Kembalikan ikon unicode untuk status.
 * @param {"available"|"occupied"|"offline"|string} status
 * @returns {string}
 */
function ikonStatus(status) {
  switch (status) {
    case "available": return "✓";
    case "occupied":  return "●";
    case "offline":   return "○";
    default:          return "?";
  }
}

/**
 * Kembalikan kelas CSS modifier untuk status.
 * @param {"available"|"occupied"|"offline"|string} status
 * @returns {string}
 */
function classStatus(status) {
  switch (status) {
    case "available": return "available";
    case "occupied":  return "occupied";
    default:          return "offline";
  }
}

/**
 * Format persentase 0-1 menjadi string "XX%".
 * @param {number|null|undefined} val
 * @returns {string}
 */
function fmtPct(val) {
  if (val == null || isNaN(val)) return "—";
  return Math.round(val * 100) + "%";
}

/**
 * Format menit menjadi string "X mnt" atau "X jam Y mnt".
 * @param {number|null|undefined} mnt
 * @returns {string}
 */
function fmtMenit(mnt) {
  if (mnt == null || isNaN(mnt)) return "—";
  const m = Math.round(mnt);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h} jam ${r} mnt` : `${h} jam`;
}

/**
 * Escape karakter HTML agar aman dimasukkan ke innerHTML.
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================
// Logic Layer — Hitung Peringatan
// ============================================================

/**
 * @typedef {Object} Peringatan
 * @property {"sistem"|"esp32"|"sensor"} tipe
 * @property {string} judul
 * @property {string} rincian
 * @property {number|null} since   - epoch ms (untuk tipe "sensor")
 */

/**
 * Hitung daftar peringatan aktif berdasarkan state saat ini.
 * Tidak menyentuh Firebase sama sekali — murni kalkulasi dari state.
 *
 * Prioritas:
 *   (a) Jika sistem offline → hanya tampilkan peringatan (a).
 *   (b) Jika beat oke tapi SEMUA kursi offline → peringatan (b).
 *   (c) Jika beat oke dan hanya SEBAGIAN kursi offline → peringatan (c) per kursi.
 *
 * @returns {Peringatan[]}
 */
function hitungPeringatan() {
  const peringatan = [];

  // (a) Sistem hilang
  if (state.sistemOffline) {
    peringatan.push({
      tipe: "sistem",
      judul: "Sistem di kafe tidak terhubung",
      rincian: "Bridge atau komputer kafe berhenti. Data yang tampil mungkin tidak terbaru.",
      since: null,
    });
    return peringatan; // (a) → jangan cek (b) dan (c)
  }

  // Cek status kursi
  const kursiOffline = SEMUA_KURSI.filter(id => {
    const s = state.seats[id];
    return !s || s.status === "offline";
  });

  // (b) Semua kursi offline padahal beat masih jalan
  if (kursiOffline.length === SEMUA_KURSI.length && SEMUA_KURSI.length > 0) {
    peringatan.push({
      tipe: "esp32",
      judul: "Perangkat sensor (ESP32) tidak mengirim data",
      rincian: "Periksa daya dan koneksi WiFi perangkat ESP32 di kafe.",
      since: null,
    });
    return peringatan;
  }

  // (c) Sebagian kursi offline
  for (const id of kursiOffline) {
    const s       = state.seats[id] || {};
    const mejaId  = s.table || cariMejaUntukKursi(id);
    const sinceMs = s.since || null;
    peringatan.push({
      tipe: "sensor",
      judul: `Sensor kursi ${id} (Meja ${mejaId}) tidak mengirim data`,
      rincian: `Periksa kabel dan posisi sensor pada kursi ${id}.`,
      since: sinceMs,
    });
  }

  return peringatan;
}

/**
 * Cari id meja pemilik sebuah kursi berdasarkan LAYOUT.
 * @param {string} kursiId
 * @returns {string}
 */
function cariMejaUntukKursi(kursiId) {
  for (const m of MEJA_CONFIG) {
    if (m.kursi.includes(kursiId)) return m.mejaId;
  }
  return "?";
}

/**
 * Hitung jumlah kursi kosong dan meja kosong dari state.
 * Offline TIDAK dihitung kosong.
 * @returns {{ kursiKosong: number, mejaKosong: number }}
 */
function hitungRingkasan() {
  let kursiKosong = 0;
  let mejaKosong  = 0;

  for (const id of SEMUA_KURSI) {
    const s = state.seats[id];
    if (s && s.status === "available") kursiKosong++;
  }

  for (const id of SEMUA_MEJA) {
    const t = state.tables[id];
    if (t && t.status === "available") mejaKosong++;
  }

  return { kursiKosong, mejaKosong };
}

// ============================================================
// Data Layer — membaca Firebase (hanya onValue, tidak ada set/push)
// ============================================================

/**
 * Pasang semua listener realtime untuk data denah:
 *   tables/, seats/, system/beat
 * Setiap perubahan data memperbarui state dan memanggil fungsi render.
 * Listener tidak pernah dipasang dua kali karena fungsi ini hanya dipanggil
 * satu kali dari main().
 */
function startDenahListeners() {
  // --- tables/ ---
  onValue(
    ref(db, "tables"),
    (snap) => {
      state.tables = snap.val() || {};
      renderDenah();
      renderPeringatan(); // peringatan bergantung pada status meja/kursi
    },
    (err) => { renderDenahError(err); }
  );

  // --- seats/ ---
  onValue(
    ref(db, "seats"),
    (snap) => {
      state.seats = snap.val() || {};
      renderDenah();
      renderPeringatan();
    },
    (err) => { renderDenahError(err); }
  );

  // --- system/beat ---
  onValue(
    ref(db, "system/beat"),
    (snap) => {
      const val = snap.val();
      // Catat waktu lokal hanya saat nilai beat benar-benar berubah
      if (val !== state.beatValue) {
        state.beatValue       = val;
        state.beatLastChanged = Date.now();
        state.sistemOffline   = false;
        renderBeatBanner(false);
        renderPeringatan(); // beat pulih → perbarui peringatan
      }
    },
    (_err) => {
      state.beatLastChanged = null;
      state.sistemOffline   = true;
      renderBeatBanner(true);
      renderPeringatan();
    }
  );

  // Cek beat setiap 5 detik; tampilkan banner dan peringatan jika >30 detik
  state.beatOfflineTimer = setInterval(() => {
    if (state.beatLastChanged === null) return;
    const usia            = Date.now() - state.beatLastChanged;
    const akanOffline     = usia > 30_000;
    const statusBerubah   = akanOffline !== state.sistemOffline;
    state.sistemOffline   = akanOffline;
    renderBeatBanner(akanOffline);
    if (statusBerubah) renderPeringatan(); // hanya render ulang saat kondisi berubah
  }, 5_000);
}

/**
 * Pasang listener untuk semua data statistik (hanya setelah login).
 * Firebase SDK sudah idempoten — tidak masalah dipanggil ulang saat
 * user logout-login lagi, karena listener sebelumnya masih aktif pada
 * ref yang sama.
 */
function startStatsListeners() {
  onValue(ref(db, "stats/jam/kerja"), (snap) => {
    state.statsJamKerja = snap.val() || {};
    renderStatsChart();
  });

  onValue(ref(db, "stats/jam/akhir_pekan"), (snap) => {
    state.statsJamAkhirPekan = snap.val() || {};
    renderStatsChart();
  });

  onValue(ref(db, "stats/jam/tersibuk"), (snap) => {
    state.statsJamTersibuk = snap.val() || {};
    renderStatsSummaryCards();
  });

  onValue(ref(db, "stats/hari_ini"), (snap) => {
    state.statsHariIni = snap.val() || {};
    renderStatsSummaryCards();
  });

  onValue(ref(db, "stats/meja"), (snap) => {
    state.statsMeja = snap.val() || {};
    renderStatsMejaTable();
  });

  onValue(ref(db, "stats/updated"), (snap) => {
    state.statsUpdated = snap.val();
    renderStatsUpdated();
  });
}

// ============================================================
// Referensi elemen DOM
// ============================================================

const el = {
  bannerWarn:      () => document.getElementById("banner-warn"),
  denahContainer:  () => document.getElementById("denah-container"),
  summaryBar:      () => document.getElementById("summary-bar"),
  lastUpdated:     () => document.getElementById("last-updated"),

  // Statistik
  statsPanel:      () => document.getElementById("panel-statistik"),
  loginWrapper:    () => document.getElementById("login-wrapper"),
  statsContent:    () => document.getElementById("stats-content"),
  loginError:      () => document.getElementById("login-error"),
  loginEmail:      () => document.getElementById("login-email"),
  loginPassword:   () => document.getElementById("login-password"),
  loginBtn:        () => document.getElementById("login-btn"),
  logoutBtn:       () => document.getElementById("logout-btn"),
  statsUserLabel:  () => document.getElementById("stats-user-label"),
  statsCards:      () => document.getElementById("stats-cards"),
  chartToggleKerja:     () => document.getElementById("chart-toggle-kerja"),
  chartToggleAkhirPekan:() => document.getElementById("chart-toggle-akhirpekan"),
  chartCanvas:     () => document.getElementById("occupancy-chart"),
  statsMejaTableBody:  () => document.getElementById("stats-meja-tbody"),
  statsUpdatedLabel:   () => document.getElementById("stats-updated-label"),
  noDataChartMsg:  () => document.getElementById("no-data-chart"),
  noDataMejaMsg:   () => document.getElementById("no-data-meja"),
  perigatanPanel:  () => document.getElementById("peringatan-panel"),
  perigatanList:   () => document.getElementById("peringatan-list"),
  tabStatistik:    () => document.getElementById("tab-statistik"),
};

// ============================================================
// Render Layer — Denah (gaya bioskop)
// ============================================================

/**
 * Tampilkan/sembunyikan banner peringatan beat (publik, tab Denah).
 * @param {boolean} tampil
 */
function renderBeatBanner(tampil) {
  const banner = el.bannerWarn();
  if (!banner) return;
  banner.classList.toggle("hidden", !tampil);
}

/**
 * SVG ikon kursi sederhana (inline).
 * @returns {string} SVG HTML
 */
function svgKursi() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="4" y="3" width="16" height="9" rx="2"/>
    <rect x="3" y="10" width="18" height="3" rx="1.5"/>
    <rect x="5" y="13" width="3" height="6" rx="1"/>
    <rect x="16" y="13" width="3" height="6" rx="1"/>
    <rect x="6" y="18" width="12" height="2" rx="1"/>
  </svg>`;
}

/**
 * Render seluruh tab Denah (denah bioskop) dari state.
 * Menjaga tooltip yang sedang terbuka jika target-nya masih valid.
 */
function renderDenah() {
  const container = el.denahContainer();
  if (!container) return;

  container.innerHTML = buildDenahHTML();

  // Pasang event listener klik pada setiap elemen interaktif denah
  container.querySelectorAll("[data-denah-id]").forEach(elem => {
    elem.addEventListener("click", (e) => {
      e.stopPropagation();
      const id      = elem.dataset.denahId;
      const tipe    = elem.dataset.denahTipe; // "meja" atau "kursi"
      toggleDenahTooltip(elem, id, tipe);
    });
    // Keyboard: Enter / Space membuka keterangan
    elem.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        elem.click();
      }
    });
  });

  renderSummary();
  renderLastUpdated();
}

/**
 * Membangun HTML denah bioskop dari LAYOUT.
 * @returns {string}
 */
function buildDenahHTML() {
  const baris = DENAH_GRID.map((row, iRow) => {
    if (row[0]?.type === "jalan") return `<div class="denah-grid-row denah-grid-row--jalan"><div class="denah-jalan">↔ &nbsp; JALAN / AREA AKSES &nbsp; ↔</div></div>`;
    const cells = Array.from({ length: 3 }, (_, col) => {
      const item = row[col];
      if (!item) return `<div class="denah-grid-cell denah-grid-cell--empty" aria-hidden="true"></div>`;
      if (item.type === "meja") return `<div class="denah-grid-cell">${buildMejaOnlyHTML(item.id)}</div>`;
      return `<div class="denah-grid-cell">${buildKursiOnlyHTML(item.id)}</div>`;
    }).join("");
    return `<div class="denah-grid-row" data-baris="${iRow}">${cells}</div>`;
  }).join("");
  const legendaHTML = `<div class="denah-legenda" aria-label="Legenda status">
    <span class="denah-legenda__item"><span class="denah-legenda__dot denah-legenda__dot--available"></span> Kosong</span>
    <span class="denah-legenda__item"><span class="denah-legenda__dot denah-legenda__dot--occupied"></span> Terisi</span>
    <span class="denah-legenda__item"><span class="denah-legenda__dot denah-legenda__dot--offline"></span> Offline</span>
  </div>`;
  return `<div class="denah-wrapper">
    <div class="denah-orientation"><span>↑</span><strong>UTARA</strong><small>Bagian depan kafe</small></div>
    ${legendaHTML}
    <div class="denah-area denah-area--grid" id="denah-area" role="group" aria-label="Denah kafe menghadap utara, grid tiga kolom enam baris">${baris}</div>
    <div class="denah-pintu"><div class="denah-pintu__garis"></div><span class="denah-pintu__label">🚪 Pintu Masuk</span></div>
    <div id="denah-tooltip" class="denah-tooltip hidden" role="status" aria-live="polite"></div>
  </div>`;
}

function buildMejaOnlyHTML(mejaId) {
  const status = state.tables[mejaId]?.status || "offline";
  return `<button class="denah-meja denah-meja--${classStatus(status)}" data-denah-id="${esc(mejaId)}" data-denah-tipe="meja" aria-label="Meja ${esc(mejaId)}, ${esc(labelStatus(status))}" type="button">
    <span class="denah-meja__icon">▦</span><span class="denah-meja__id">${esc(mejaId)}</span><span class="denah-meja__badge">${esc(labelStatus(status))}</span></button>`;
}

function buildKursiOnlyHTML(kursiId) {
  const status = state.seats[kursiId]?.status || "offline";
  return `<button class="denah-kursi denah-kursi--${classStatus(status)}" data-denah-id="${esc(kursiId)}" data-denah-tipe="kursi" aria-label="Kursi ${esc(kursiId)}, ${esc(labelStatus(status))}" type="button">
    ${svgKursi()}<span class="denah-kursi__label">${esc(kursiId)}</span><span class="denah-kursi__state">${esc(labelStatus(status))}</span></button>`;
}

/**
 * Bangun HTML satu sel meja beserta kursi-kursinya (gaya bioskop).
 * @param {string} mejaId
 * @param {string[]} kursi
 * @returns {string}
 */
function buildMejaCellHTML(mejaId, kursi) {
  const mejaData = state.tables[mejaId] || {};
  const ms       = mejaData.status || "offline";

  // Kursi di atas meja
  const kursiHTML = kursi.map(kId => {
    const k   = state.seats[kId] || {};
    const ks  = k.status || "offline";
    return `<button
      class="denah-kursi denah-kursi--${classStatus(ks)}"
      data-denah-id="${esc(kId)}"
      data-denah-tipe="kursi"
      aria-label="Kursi ${esc(kId)}, ${esc(labelStatus(ks))}"
      type="button"
    >${svgKursi()}<span class="denah-kursi__label">${esc(kId)}</span></button>`;
  }).join("");

  return `
    <div class="denah-meja-cell">
      <div class="denah-kursi-row">${kursiHTML}</div>
      <button
        class="denah-meja denah-meja--${classStatus(ms)}"
        data-denah-id="${esc(mejaId)}"
        data-denah-tipe="meja"
        aria-label="Meja ${esc(mejaId)}, ${esc(labelStatus(ms))}"
        type="button"
      >
        <span class="denah-meja__id">${esc(mejaId)}</span>
        <span class="denah-meja__badge">
          <span class="icon" aria-hidden="true">${esc(ikonStatus(ms))}</span>
          ${esc(labelStatus(ms))}
        </span>
      </button>
    </div>`;
}

/**
 * Tampilkan atau sembunyikan tooltip keterangan meja/kursi.
 * Mengetuk elemen yang sama menutup tooltip.
 * @param {HTMLElement} targetElem
 * @param {string} id   - id meja atau kursi
 * @param {"meja"|"kursi"} tipe
 */
function toggleDenahTooltip(targetElem, id, tipe) {
  const tooltip = document.getElementById("denah-tooltip");
  if (!tooltip) return;

  // Tutup jika target yang sama diklik lagi
  if (state.denahTooltipTarget === id) {
    tooltip.classList.add("hidden");
    state.denahTooltipTarget = null;
    return;
  }

  state.denahTooltipTarget = id;

  let nama, status, sinceMs;
  if (tipe === "meja") {
    const d  = state.tables[id] || {};
    nama     = `Meja ${id}`;
    status   = d.status || "offline";
    sinceMs  = d.since  || null;
  } else {
    const d  = state.seats[id] || {};
    const mejaId = d.table || cariMejaUntukKursi(id);
    nama     = `Kursi ${id} (Meja ${mejaId})`;
    status   = d.status || "offline";
    sinceMs  = d.since  || null;
  }

  const sinceText = formatRelative(sinceMs);
  const cls       = classStatus(status);

  tooltip.className = `denah-tooltip denah-tooltip--${cls}`;
  tooltip.innerHTML = `
    <strong>${esc(nama)}</strong>
    <span class="denah-tooltip__status">
      <span class="icon" aria-hidden="true">${esc(ikonStatus(status))}</span>
      ${esc(labelStatus(status))}
    </span>
    <span class="denah-tooltip__since">Sejak: ${esc(sinceText)}</span>
    <button class="denah-tooltip__close" type="button" aria-label="Tutup keterangan">×</button>`;

  tooltip.querySelector(".denah-tooltip__close").addEventListener("click", (e) => {
    e.stopPropagation();
    tooltip.classList.add("hidden");
    state.denahTooltipTarget = null;
  });

  tooltip.classList.remove("hidden");
}

/**
 * Perbarui ringkasan kursi dan meja kosong.
 */
function renderSummary() {
  const bar = el.summaryBar();
  if (!bar) return;
  const { kursiKosong, mejaKosong } = hitungRingkasan();
  bar.innerHTML = `
    <span class="summary-chip">🪑 ${esc(String(kursiKosong))} dari ${SEMUA_KURSI.length} kursi kosong</span>
    <span class="summary-chip">🪵 ${esc(String(mejaKosong))} dari ${SEMUA_MEJA.length} meja kosong</span>
  `;
}

/**
 * Perbarui label "Terakhir diperbarui".
 */
function renderLastUpdated() {
  const lbl = el.lastUpdated();
  if (!lbl) return;
  const now = new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  lbl.textContent = `Terakhir diperbarui: ${now}`;
}

/**
 * Tampilkan pesan error di tab Denah.
 * @param {Error} err
 */
function renderDenahError(err) {
  const container = el.denahContainer();
  if (!container) return;
  const msg = err.code === "PERMISSION_DENIED"
    ? "Akses ke data ditolak. Periksa aturan keamanan Firebase."
    : `Gagal memuat data: ${err.message}`;
  container.innerHTML = `
    <div class="state-box" role="alert">
      <p class="state-box__title">⚠ Tidak Dapat Memuat Data</p>
      <p class="state-box__msg">${esc(msg)}</p>
    </div>`;
}

/**
 * Tampilkan pesan error fatal yang memblokir seluruh halaman.
 * @param {string} judul
 * @param {string} pesan
 */
function renderFatalError(judul, pesan) {
  const body = document.body;
  if (!body) return;
  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,sans-serif;padding:2rem;">
      <div style="max-width:420px;text-align:center;">
        <p style="font-size:2rem;margin-bottom:1rem;">⚠️</p>
        <h1 style="font-size:1.2rem;margin-bottom:.5rem;">${esc(judul)}</h1>
        <p style="color:#6b7280;font-size:.9rem;">${esc(pesan)}</p>
      </div>
    </div>`;
}

// ============================================================
// Render Layer — Panel Peringatan (staf, tab Statistik)
// ============================================================

/**
 * Render daftar peringatan aktif di panel peringatan staf.
 * Panel hanya terlihat setelah login (tersembunyi di HTML awalnya).
 * Juga memperbarui lencana angka di tombol tab dan judul browser.
 */
function renderPeringatan() {
  // Panel hanya dirender jika staf sudah login
  if (!state.currentUser) return;

  const panel = el.perigatanPanel();
  const list  = el.perigatanList();
  if (!panel || !list) return;

  const daftar = hitungPeringatan();

  // Lencana angka di tombol tab Statistik
  renderTabBadge(daftar.length);

  // Judul browser: awali dengan "(!)" jika ada peringatan
  const judulDasar = "Tablespot Dashboard";
  document.title   = daftar.length > 0 ? `(!) ${judulDasar}` : judulDasar;

  if (daftar.length === 0) {
    list.innerHTML = `
      <p class="peringatan-kosong">
        <span aria-hidden="true">✅</span> Tidak ada peringatan. Semua sensor normal.
      </p>`;
    return;
  }

  list.innerHTML = daftar.map(p => {
    const ikonTipe = p.tipe === "sistem" ? "🔌" : p.tipe === "esp32" ? "📡" : "⚠️";
    const sinceHTML = p.since
      ? `<span class="peringatan-since">Sejak: ${esc(formatRelative(p.since))}</span>`
      : "";
    return `
      <div class="peringatan-item peringatan-item--${esc(p.tipe)}" role="alert">
        <span class="peringatan-item__ikon" aria-hidden="true">${ikonTipe}</span>
        <div class="peringatan-item__body">
          <strong class="peringatan-item__judul">${esc(p.judul)}</strong>
          <span class="peringatan-item__rincian">${esc(p.rincian)}</span>
          ${sinceHTML}
        </div>
      </div>`;
  }).join("");
}

/**
 * Tampilkan atau sembunyikan lencana angka merah di tombol tab Statistik.
 * @param {number} jumlah
 */
function renderTabBadge(jumlah) {
  const tabBtn = el.tabStatistik();
  if (!tabBtn) return;

  // Hapus lencana lama jika ada
  const lama = tabBtn.querySelector(".tab-badge");
  if (lama) lama.remove();

  if (jumlah > 0) {
    const badge = document.createElement("span");
    badge.className   = "tab-badge";
    badge.textContent = String(jumlah);
    badge.setAttribute("aria-label", `${jumlah} peringatan`);
    tabBtn.appendChild(badge);
  }
}

// ============================================================
// Render Layer — Statistik
// ============================================================

/** Instance Chart.js aktif */
let chartInstance = null;

/** Mode grafik saat ini: "kerja" atau "akhir_pekan" */
let chartMode = "kerja";

/**
 * Bangun HTML tombol info (ⓘ) dengan keterangan yang bisa diketuk.
 * @param {string} idPopup - id unik untuk elemen popup
 * @param {string} keterangan - teks keterangan
 * @returns {string}
 */
function infoBtn(idPopup, keterangan) {
  return `<button
    class="info-btn"
    type="button"
    aria-label="Keterangan: ${esc(keterangan)}"
    data-info-id="${esc(idPopup)}"
    data-info-text="${esc(keterangan)}"
  >ⓘ</button><span class="info-popup hidden" id="${esc(idPopup)}" role="tooltip">${esc(keterangan)}</span>`;
}

/**
 * Tampilkan form login, sembunyikan konten statistik.
 */
function renderLoginForm() {
  const lw = el.loginWrapper();
  const sc = el.statsContent();
  if (lw) lw.style.display = "";
  if (sc) sc.style.display = "none";

  // Sembunyikan peringatan dan bersihkan badge saat logout
  const panel = el.perigatanPanel();
  if (panel) panel.style.display = "none";
  renderTabBadge(0);
  document.title = "Tablespot Dashboard";
}

/**
 * Tampilkan konten statistik, sembunyikan form login.
 * @param {import("firebase/auth").User} user
 */
function renderStatsLoggedIn(user) {
  const lw    = el.loginWrapper();
  const sc    = el.statsContent();
  const lbl   = el.statsUserLabel();
  const panel = el.perigatanPanel();
  if (lw)    lw.style.display    = "none";
  if (sc)    sc.style.display    = "";
  if (panel) panel.style.display = "";
  if (lbl)   lbl.textContent     = user.email;

  // Render peringatan sekarang karena state.currentUser baru saja diset
  renderPeringatan();

  // Mulai listener statistik (Firebase SDK sudah idempoten)
  startStatsListeners();
}

/**
 * Render kartu ringkasan statistik hari ini + jam tersibuk.
 * Setiap kartu mendapat tombol info ⓘ yang bisa diketuk.
 */
function renderStatsSummaryCards() {
  const container = el.statsCards();
  if (!container) return;

  const hi = state.statsHariIni;
  const jt = state.statsJamTersibuk;

  const jamKerja     = jt.kerja       ? `Pukul ${jt.kerja}:00`       : "—";
  const jamAkhirPekan= jt.akhir_pekan ? `Pukul ${jt.akhir_pekan}:00` : "—";

  container.innerHTML = `
    <div class="stat-card">
      <p class="stat-card__label">
        Jam Tersibuk (Hari Kerja)
        ${infoBtn("info-jam-kerja", "Jam dengan rata-rata okupansi di atas 80% pada hari kerja (Senin–Jumat).")}
      </p>
      <p class="stat-card__value">${esc(jamKerja)}</p>
    </div>
    <div class="stat-card">
      <p class="stat-card__label">
        Jam Tersibuk (Akhir Pekan)
        ${infoBtn("info-jam-akhirpekan", "Jam dengan rata-rata okupansi di atas 80% pada akhir pekan (Sabtu–Minggu).")}
      </p>
      <p class="stat-card__value">${esc(jamAkhirPekan)}</p>
    </div>
    <div class="stat-card">
      <p class="stat-card__label">
        Giliran Hari Ini
        ${infoBtn("info-giliran-harini", "Jumlah kali meja berubah dari kosong menjadi terisi hari ini. Pemakaian kurang dari 2 menit tidak dihitung.")}
      </p>
      <p class="stat-card__value">${esc(String(hi.giliran ?? "—"))}</p>
    </div>
    <div class="stat-card">
      <p class="stat-card__label">
        Rata-rata Lama Pemakaian
        ${infoBtn("info-rata-lama", "Rata-rata lama sekali duduk di kafe hari ini, dalam menit.")}
      </p>
      <p class="stat-card__value">${esc(fmtMenit(hi.rata_lama_menit))}</p>
      <p class="stat-card__sub">hari ini</p>
    </div>
  `;

  // Pasang event listener info tombol di kartu
  container.querySelectorAll(".info-btn").forEach(btn => pasangInfoBtn(btn));
}

/**
 * Render / refresh grafik batang Chart.js sesuai chartMode.
 * Jam dengan nilai > 80% disorot merah sebagai "ramai".
 */
function renderStatsChart() {
  const canvas    = el.chartCanvas();
  const noDataMsg = el.noDataChartMsg();
  if (!canvas) return;

  const dataset = chartMode === "kerja"
    ? state.statsJamKerja
    : state.statsJamAkhirPekan;

  const nilaiAda = JAM_RANGE.some(j => dataset[j] != null);
  if (!nilaiAda) {
    canvas.style.display = "none";
    if (noDataMsg) noDataMsg.style.display = "";
    return;
  }

  canvas.style.display = "";
  if (noDataMsg) noDataMsg.style.display = "none";

  const labels = JAM_RANGE.map(j => `${j}:00`);
  const values = JAM_RANGE.map(j => {
    const v = dataset[j];
    return v != null ? Math.round(v * 100) : 0;
  });

  const bgColors = values.map(v =>
    v > 80 ? "rgba(220,38,38,0.75)" : "rgba(37,99,235,0.75)"
  );

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  // Chart.js dimuat sebagai script UMD di index.html.
  // Gunakan window.Chart agar akses global dari ES module lebih eksplisit.
  const ChartJS = window.Chart;
  if (typeof ChartJS !== "function") {
    console.error("[Tablespot] Chart.js tidak tersedia. Periksa koneksi/CDN di tab Network.");
    canvas.style.display = "none";
    if (noDataMsg) {
      noDataMsg.textContent = "Grafik gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.";
      noDataMsg.style.display = "";
    }
    return;
  }

  try {
    chartInstance = new ChartJS(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Okupansi (%)",
        data: values,
        backgroundColor: bgColors,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              return ` ${v}%${v > 80 ? " 🔴 ramai" : ""}`;
            },
          },
        },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (v) => v + "%" },
          grid: { color: "rgba(0,0,0,.06)" },
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 } },
        },
      },
    },
    });
  } catch (error) {
    console.error("[Tablespot] Gagal membuat grafik:", error);
    canvas.style.display = "none";
    if (noDataMsg) {
      noDataMsg.textContent = "Grafik tidak dapat ditampilkan. Silakan muat ulang halaman.";
      noDataMsg.style.display = "";
    }
  }
}

/**
 * Render tabel pemakaian per meja.
 * Kolom header memiliki tombol info ⓘ yang bisa diketuk.
 */
function renderStatsMejaTable() {
  const tbody     = el.statsMejaTableBody();
  const noDataMsg = el.noDataMejaMsg();
  if (!tbody) return;

  const adaData = SEMUA_MEJA.some(id => state.statsMeja[id] != null);
  if (!adaData) {
    tbody.innerHTML = "";
    if (noDataMsg) noDataMsg.style.display = "";
    return;
  }
  if (noDataMsg) noDataMsg.style.display = "none";

  tbody.innerHTML = SEMUA_MEJA.map(id => {
    const d = state.statsMeja[id] || {};
    return `<tr>
      <td><strong>${esc(id)}</strong></td>
      <td>${esc(String(d.giliran ?? "—"))}</td>
      <td>${esc(fmtMenit(d.rata_lama_menit))}</td>
      <td>${esc(fmtPct(d.persen_terisi))}</td>
    </tr>`;
  }).join("");
}

/**
 * Perbarui label "Statistik dihitung pada ...".
 */
function renderStatsUpdated() {
  const lbl = el.statsUpdatedLabel();
  if (!lbl) return;
  if (!state.statsUpdated) { lbl.textContent = ""; return; }
  const d = new Date(state.statsUpdated);
  lbl.textContent = `Statistik dihitung pada: ${d.toLocaleString("id-ID")}`;
}

// ============================================================
// Logika tombol Info (ⓘ) — tab Statistik
// ============================================================

/**
 * Pasang event listener klik pada sebuah tombol info.
 * Mengetuk tombol yang sama menutup popup.
 * @param {HTMLElement} btn
 */
function pasangInfoBtn(btn) {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const targetId = btn.dataset.infoId;
    const popup    = document.getElementById(targetId);
    if (!popup) return;

    // Tutup popup lain yang sedang terbuka
    document.querySelectorAll(".info-popup:not(.hidden)").forEach(p => {
      if (p.id !== targetId) p.classList.add("hidden");
    });

    popup.classList.toggle("hidden");
  });
}

// ============================================================
// Controller — Auth & Tab
// ============================================================

/**
 * Terjemahkan kode error Firebase Auth ke Bahasa Indonesia.
 * @param {string} code
 * @returns {string}
 */
function terjemahkanErrorAuth(code) {
  switch (code) {
    case "auth/invalid-email":         return "Format email tidak valid.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":    return "Email atau kata sandi salah.";
    case "auth/too-many-requests":     return "Terlalu banyak percobaan login. Coba lagi beberapa saat.";
    case "auth/network-request-failed":return "Gagal terhubung ke jaringan. Periksa koneksi internet.";
    case "auth/user-disabled":         return "Akun ini telah dinonaktifkan.";
    default:                           return `Login gagal (${code}). Coba lagi.`;
  }
}

/**
 * Tampilkan atau sembunyikan pesan error login.
 * @param {string|null} msg
 */
function setLoginError(msg) {
  const elErr = el.loginError();
  if (!elErr) return;
  if (msg) {
    elErr.textContent = msg;
    elErr.classList.remove("hidden");
  } else {
    elErr.classList.add("hidden");
  }
}

/**
 * Inisialisasi semua event listener UI (dipanggil sekali dari main).
 */
function initUI() {
  // --- Tab switching ---
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      const panel = document.getElementById(`panel-${target}`);
      if (panel) panel.classList.add("active");
    });
  });

  // --- Tutup tooltip denah saat klik di luar ---
  document.addEventListener("click", () => {
    const tooltip = document.getElementById("denah-tooltip");
    if (tooltip && !tooltip.classList.contains("hidden")) {
      tooltip.classList.add("hidden");
      state.denahTooltipTarget = null;
    }
    // Tutup popup info statistik
    document.querySelectorAll(".info-popup:not(.hidden)").forEach(p => p.classList.add("hidden"));
  });

  // --- Toggle grafik hari kerja / akhir pekan ---
  const btnKerja      = el.chartToggleKerja();
  const btnAkhirPekan = el.chartToggleAkhirPekan();

  if (btnKerja) {
    btnKerja.addEventListener("click", () => {
      chartMode = "kerja";
      btnKerja.classList.add("active");
      if (btnAkhirPekan) btnAkhirPekan.classList.remove("active");
      renderStatsChart();
    });
  }

  if (btnAkhirPekan) {
    btnAkhirPekan.addEventListener("click", () => {
      chartMode = "akhir_pekan";
      btnAkhirPekan.classList.add("active");
      if (btnKerja) btnKerja.classList.remove("active");
      renderStatsChart();
    });
  }

  // --- Login ---
  const loginBtn = el.loginBtn();
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      const email    = el.loginEmail()?.value.trim() || "";
      const password = el.loginPassword()?.value      || "";

      if (!email || !password) {
        setLoginError("Email dan kata sandi tidak boleh kosong.");
        return;
      }

      setLoginError(null);
      loginBtn.disabled    = true;
      loginBtn.textContent = "Masuk...";

      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        setLoginError(terjemahkanErrorAuth(err.code));
      } finally {
        loginBtn.disabled    = false;
        loginBtn.textContent = "Masuk";
      }
    });

    el.loginPassword()?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loginBtn.click();
    });
  }

  // --- Logout ---
  const logoutBtn = el.logoutBtn();
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
    });
  }

  // --- Auth state ---
  onAuthStateChanged(auth, (user) => {
    state.currentUser = user;
    if (user) {
      renderStatsLoggedIn(user);
    } else {
      renderLoginForm();
    }
  });
}

// ============================================================
// Bootstrap
// ============================================================

function main() {
  // Loading awal di tab Denah
  const container = el.denahContainer();
  if (container) {
    container.innerHTML = `
      <div class="state-box">
        <div class="spinner" role="status" aria-label="Memuat data..."></div>
        <p class="state-box__title">Memuat data...</p>
        <p class="state-box__msg">Menghubungkan ke Firebase Realtime Database</p>
      </div>`;
  }

  startDenahListeners();
  initUI();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
