# LyricsBay - Control Center

LyricsBay adalah aplikasi visual lirik interaktif dengan scroll ke atas otomatis, transparansi bertingkat, trigger keyboard vMix, autentikasi user, pengelolaan lagu, dan sistem playlist setlist acara.

---

## 🔐 Akun Login Default

| Username | Password | Peran |
| :--- | :--- | :--- |
| **`admin`** | **`admin123`** | Administrator (Akses Penuh) |
| **`operator`** | **`operator123`** | Show Operator |

*(Terdapat juga tombol pintas pada halaman login untuk masuk langsung sebagai admin)*

---

## 🚀 Cara Menjalankan

1. Cukup klik ganda (double-click) file:
   👉 **`jalankan-aplikasi.bat`**
2. Browser akan terbuka otomatis di:
   - Panel Operator: **`http://localhost:3000/`**
3. Masukkan username & password untuk masuk ke dashboard.
4. Input vMix Browser Overlay:
   - URL: **`http://localhost:3000/overlay`** *(Akses ke vMix selalu terbuka tanpa perlu login)*

---

## 📁 Fitur Utama Dashboard

### 1. 🎮 Live Controller
- Menjalankan lirik lagu secara real-time saat live streaming / panggung acara.
- Pilihan **Playlist Aktif** yang terpasang untuk rundown acara.
- Trigger Keyboard lengkap:
  - `Spasi` / `Panah Bawah (↓)` / `Enter`: Pindah ke baris lirik berikutnya (scroll ke atas).
  - `Panah Atas (↑)`: Kembali ke baris sebelumnya.
  - `B`: Toggle Blank / sembunyikan teks.
  - `Home`: Reset kembali ke baris 1.
  - `]` / `[`: Pindah ke lagu berikutnya / sebelumnya dalam playlist.
  - `Klik Baris`: Langsung lompat ke baris yang dipilih.
- Monitor preview vMix langsung di layar operator.

### 2. 🎵 Kelola Lagu (Song Library)
- Mencari lagu berdasarkan judul, artis, maupun potongan lirik.
- Menambah lagu baru (**+ Tambah Lagu Baru**) cukup dengan paste lirik.
- Mengedit judul, artis, dan lirik lagu kapan saja.
- Menghapus lagu dari perpustakaan.

### 3. 📋 Kelola Playlist (Setlist)
- Membuat playlist baru sesuai sesi / rundown (contoh: *Talent Show - Main Setlist*, *Sesi Akustik*, dll.).
- Memilih lagu-lagu dari perpustakaan untuk dimasukkan ke playlist.
- Mengatur urutan lagu dengan tombol **▲ (Naik)** dan **▼ (Turun)**.
- Tombol **🎯 Pasang di Live Show** untuk langsung mengaktifkan playlist tersebut di panggung live!

### 4. 🎨 Setting Visual & Font
- Pilihan Font (*Montserrat, Poppins, Inter, Bebas Neue, Roboto, Arial*).
- Slider ukuran font konsisten (semua baris konsisten bentuknya sehingga tidak melompat).
- Transparansi baris lain, warna teks, garis tepi (*stroke*), dan efek *glow*.
- Pilihan posisi tengah layar (50%) atau lower-third (70%).
