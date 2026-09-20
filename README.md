<p align="center">
  <img src="public/favicon.svg" width="72" height="72" alt="Logo TerasDocs">
</p>

<h1 align="center">TerasDocs</h1>

<p align="center">
  Platform dokumentasi multi-proyek yang ringan, mandiri, dan mudah dikelola.<br>
  Tulis dengan Markdown, simpan sebagai file, dan publikasikan tanpa database eksternal.
</p>

TerasDocs adalah platform dokumentasi self-hosted dengan website publik dan panel admin bawaan. Metadata disimpan dalam JSON, sedangkan isi halaman disimpan sebagai Markdown sehingga instalasinya sederhana, mudah dipindahkan, dan tetap dapat dicadangkan sebagai file biasa.

## Fitur utama

- Beberapa proyek dokumentasi dalam satu instalasi.
- Struktur proyek, bagian, dan halaman yang dapat diurutkan dengan drag-and-drop.
- Editor Markdown dengan preview langsung dan dukungan baris baru ala editor teks.
- Pencarian global serta filter halaman dalam proyek aktif.
- Media Library mandiri dengan status penggunaan, filter, dan pembersihan file yang tidak terpakai.
- Embed YouTube dan Vimeo dengan pembatasan host.
- Panel admin dengan autentikasi, pembatasan percobaan login, dan perlindungan CSRF.
- Sanitasi HTML, Content Security Policy, dan validasi unggahan.
- Tampilan responsif, mode gelap, serta navigasi halaman sebelumnya/selanjutnya.
- Backup otomatis sebelum perubahan data.
- Deployment melalui Docker Compose, systemd, atau Supervisor.

## Teknologi

| Komponen | Teknologi |
| --- | --- |
| Server | Node.js 22 dan Express 5 |
| Antarmuka | HTML, JavaScript, dan Tailwind CSS 4 |
| Konten | Markdown dengan Marked |
| Keamanan HTML | sanitize-html |
| Penyimpanan | JSON, Markdown, dan filesystem lokal |

## Daftar isi

- [Mulai cepat](#mulai-cepat)
- [Pengembangan](#pengembangan)
- [Konfigurasi](#konfigurasi)
- [Deploy ke VPS](#deploy-ke-vps)
- [Penyimpanan](#penyimpanan)
- [Media dan lampiran](#media-dan-lampiran)
- [Keamanan](#keamanan)
- [Kontribusi](#kontribusi)

## Mulai cepat

Persyaratan:

- Node.js 22 atau lebih baru.
- npm yang tersedia bersama Node.js.

```bash
git clone URL_REPOSITORY_ANDA
cd terasdocs
npm ci
cp .env.example .env
npm run hash-password -- "ganti-dengan-password-kuat"
```

Ganti `URL_REPOSITORY_ANDA` dengan URL repository yang telah dibuat. Salin hasil hash ke `ADMIN_PASSWORD_HASH` dalam `.env`. Untuk penggunaan lokal melalui HTTP, atur:

```env
NODE_ENV=development
COOKIE_SECURE=false
```

```bash
npm run build
npm start
```

Buka:

- Website: `http://localhost:3000`
- Admin: `http://localhost:3000/admin/`

Saat pertama dijalankan, TerasDocs membuat struktur penyimpanan dan contoh dokumentasi secara otomatis.

## Pengembangan

Jalankan watcher CSS dan server pada dua terminal terpisah:

```bash
npm run dev:css
npm run dev
```

Perintah yang tersedia:

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev` | Menjalankan server dengan file watcher |
| `npm run dev:css` | Mengompilasi Tailwind CSS saat file berubah |
| `npm run build` | Membuat CSS produksi yang diminifikasi |
| `npm start` | Menjalankan server tanpa watcher |
| `npm test` | Menjalankan test suite |
| `npm run hash-password -- "password"` | Membuat hash password admin |

## Konfigurasi

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Alamat tempat server menerima koneksi |
| `PORT` | `3000` | Port HTTP aplikasi |
| `NODE_ENV` | `development` | Gunakan `production` pada server publik |
| `ADMIN_USERNAME` | `admin` | Username panel admin |
| `ADMIN_PASSWORD_HASH` | kosong | Hash scrypt; login produksi nonaktif jika kosong |
| `COOKIE_SECURE` | `false` | Gunakan `true` jika aplikasi sudah memakai HTTPS; `.env.example` memakai `true` untuk deployment produksi |
| `SESSION_HOURS` | `8` | Masa berlaku sesi admin dalam jam |
| `MAX_UPLOAD_MB` | `50` | Batas ukuran satu file unggahan |
| `BACKUP_RETENTION` | `30` | Jumlah snapshot otomatis terbaru yang dipertahankan |
| `MAX_BACKUP_MB` | `512` | Batas ukuran arsip restore, terkompresi dan setelah diekstrak |
| `STORAGE_DIR` | `./storage` | Lokasi penyimpanan data, bersifat opsional |

## Deploy ke VPS

Contoh di bawah menggunakan:

- Ubuntu atau Debian sebagai sistem operasi VPS.
- `/opt/terasdocs` sebagai direktori aplikasi.
- `docs.example.com` sebagai domain. Ganti dengan domain yang digunakan.
- Nginx sebagai reverse proxy ke aplikasi pada `127.0.0.1:3000`.

TerasDocs hanya boleh dijalankan sebagai satu instance karena metadata JSON dan konten Markdown ditulis ke satu direktori `storage`.

### Menyiapkan aplikasi

Buat direktori aplikasi di VPS:

```bash
sudo mkdir -p /opt/terasdocs
sudo chown "$USER":"$USER" /opt/terasdocs
```

Kirim proyek dari komputer lokal tanpa Git:

```bash
rsync -az \
  --exclude node_modules \
  --exclude .env \
  ./ user@IP_VPS:/opt/terasdocs/
```

Pada deployment pertama, folder `storage` ikut dikirim agar konten yang sudah dibuat tersedia di VPS. Untuk update berikutnya, folder ini harus dikecualikan agar data produksi tidak tertimpa.

Masuk ke VPS dan buat konfigurasi produksi:

```bash
cd /opt/terasdocs
cp .env.example .env
```

Buat hash password pada komputer yang memiliki Node.js:

```bash
npm run hash-password -- "ganti-dengan-password-kuat"
```

Masukkan hasilnya ke `.env`:

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=scrypt:hasil-hash-di-sini
COOKIE_SECURE=true
SESSION_HOURS=8
MAX_UPLOAD_MB=50
BACKUP_RETENTION=30
MAX_BACKUP_MB=512
```

Gunakan `COOKIE_SECURE=true` setelah HTTPS aktif. Jika sementara masih mengakses aplikasi melalui HTTP, gunakan `false` agar cookie login dapat dikirim oleh browser.

### Pilihan A: Docker Compose

Install Docker Engine beserta plugin Docker Compose pada VPS. Konfigurasi bawaan hanya mengikat port aplikasi ke loopback VPS agar port `3000` tidak terbuka langsung ke internet:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

Validasi konfigurasi, bangun image, lalu jalankan container:

```bash
cd /opt/terasdocs
docker compose config --quiet
docker compose up -d --build
```

Periksa container, log, dan endpoint kesehatan:

```bash
docker compose ps
docker compose logs --tail=100 docs
curl http://127.0.0.1:3000/api/health
```

Direktori `/opt/terasdocs/storage` dipasang ke `/app/storage` sebagai bind mount persisten. Membuat ulang container tidak menghapus data selama folder tersebut tidak dihapus.

### Pilihan B: Node.js dengan systemd

Install Node.js 22 atau lebih baru, kemudian pasang dependency dan bangun CSS:

```bash
cd /opt/terasdocs
npm ci
npm run build
sudo useradd --system --home /opt/terasdocs --shell /usr/sbin/nologin terasdocs
sudo chown -R terasdocs:terasdocs /opt/terasdocs/storage
sudo chown "$USER":terasdocs /opt/terasdocs/.env
sudo chmod 640 /opt/terasdocs/.env
```

Jika user `terasdocs` sudah ada, pesan dari `useradd` dapat diabaikan. Source code tetap dimiliki user deployment agar pembaruan melalui `rsync` dapat dilakukan, sedangkan service memperoleh akses tulis ke `storage`. Pastikan lokasi Node.js dengan `command -v node`, kemudian sesuaikan `ExecStart` jika hasilnya bukan `/usr/bin/node`.

Buat `/etc/systemd/system/terasdocs.service`:

```ini
[Unit]
Description=TerasDocs
After=network.target

[Service]
Type=simple
User=terasdocs
Group=terasdocs
WorkingDirectory=/opt/terasdocs
EnvironmentFile=/opt/terasdocs/.env
ExecStart=/usr/bin/node /opt/terasdocs/src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Aktifkan dan periksa service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now terasdocs
sudo systemctl status terasdocs
sudo journalctl -u terasdocs -n 100 --no-pager
```

### Pilihan C: Node.js dengan Supervisor

Pilihan ini menggunakan instalasi Node.js, `npm ci`, dan `npm run build` yang sama seperti metode systemd. Jangan menjalankan systemd dan Supervisor secara bersamaan karena keduanya akan menggunakan port `3000`.

Install Supervisor dan siapkan direktori log:

```bash
sudo apt update
sudo apt install supervisor
sudo install -d -o terasdocs -g terasdocs /var/log/terasdocs
```

Buat `/etc/supervisor/conf.d/terasdocs.conf`:

```ini
[program:terasdocs]
command=/usr/bin/node --env-file=.env src/server.js
directory=/opt/terasdocs
user=terasdocs
numprocs=1
autostart=true
autorestart=unexpected
startsecs=5
startretries=3
stopsignal=TERM
stopasgroup=true
killasgroup=true
stdout_logfile=/var/log/terasdocs/app.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stderr_logfile=/var/log/terasdocs/error.log
stderr_logfile_maxbytes=10MB
stderr_logfile_backups=5
```

Jika `command -v node` menghasilkan lokasi selain `/usr/bin/node`, sesuaikan nilai `command`. Muat konfigurasi dan jalankan aplikasi:

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status terasdocs
```

Perintah operasional yang umum:

```bash
sudo supervisorctl restart terasdocs
sudo supervisorctl stop terasdocs
sudo supervisorctl start terasdocs
tail -f /var/log/terasdocs/app.log
```

### Nginx dan HTTPS

Install Nginx:

```bash
sudo apt update
sudo apt install nginx
```

Buat `/etc/nginx/sites-available/terasdocs`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name docs.example.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktifkan konfigurasi:

```bash
sudo ln -s /etc/nginx/sites-available/terasdocs /etc/nginx/sites-enabled/terasdocs
sudo nginx -t
sudo systemctl reload nginx
```

Pasang sertifikat HTTPS menggunakan Certbot:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d docs.example.com
```

Setelah HTTPS aktif, pastikan `.env` menggunakan `COOKIE_SECURE=true`, lalu restart aplikasi sesuai metode deployment yang dipilih.

### Memperbarui aplikasi tanpa Git

Kirim perubahan dari komputer lokal tanpa menimpa konfigurasi dan data produksi:

```bash
rsync -az \
  --exclude node_modules \
  --exclude .env \
  --exclude storage \
  ./ user@IP_VPS:/opt/terasdocs/
```

Untuk Docker:

```bash
cd /opt/terasdocs
docker compose up -d --build
docker compose logs --tail=100 docs
```

Untuk systemd:

```bash
cd /opt/terasdocs
npm ci
npm run build
sudo systemctl restart terasdocs
```

Untuk Supervisor:

```bash
cd /opt/terasdocs
npm ci
npm run build
sudo supervisorctl restart terasdocs
```

### Backup data

Backup utama adalah seluruh folder `/opt/terasdocs/storage`. Untuk mendapatkan snapshot yang konsisten, hentikan aplikasi sebentar sebelum membuat arsip.

Dengan Docker:

```bash
cd /opt/terasdocs
docker compose stop docs
sudo tar -czf /var/backups/terasdocs-storage.tar.gz storage
docker compose start docs
```

Dengan systemd atau Supervisor, ganti perintah stop/start dengan pengelola proses yang digunakan. Simpan salinan backup di server atau penyimpanan lain, bukan hanya pada VPS yang sama.

## Penyimpanan

```text
storage/
├── .initialized
├── projects.json
├── sections.json
├── documents.json
├── media.json
├── content/<project-id>/<document-id>.md
├── backups/
├── uploads/
└── .restore/  # sementara, hanya ada selama pemeriksaan restore
```

Mutasi diserialkan dalam satu proses dan file JSON ditulis secara atomik. Snapshot metadata dan konten dibuat sebelum perubahan. Arsitektur ini ditujukan untuk satu instance aplikasi; jangan menjalankan beberapa replica yang menulis volume yang sama.

Navigasi publik dimuat per proyek. Sidebar kiri menampilkan daftar proyek, sedangkan sidebar kanan menampilkan section dan halaman dari proyek aktif. Section dapat dilipat dan daftar halaman memiliki filter lokal. Pada layar kecil, keduanya digabung dalam satu drawer. Pencarian global menggunakan indeks dalam memori yang diperbarui setelah perubahan konten.

Dokumen lama yang belum memiliki section otomatis dimigrasikan ke section `Umum` saat server dijalankan. Snapshot sebelum migrasi disimpan dalam `storage/backups`.

Session admin disimpan di memori sehingga admin harus login kembali setelah server dimulai ulang. Snapshot otomatis lama dibersihkan setelah jumlahnya melampaui `BACKUP_RETENTION`; backup lengkap manual dipertahankan sampai dihapus oleh admin.

Panel admin menyediakan menu **Backup** untuk membuat backup lengkap, melihat snapshot otomatis, mengunduh arsip `.tar.gz`, menghapus backup, dan memulihkan backup lengkap. Sebelum restore diterapkan, arsip divalidasi dan ringkasan isinya ditampilkan. Sistem juga membuat backup pengaman dari kondisi terkini agar pemulihan dapat dibatalkan secara manual jika diperlukan.

Backup lengkap mencakup metadata, seluruh Markdown, media, dan lampiran, tetapi tidak menyertakan riwayat backup lain di dalamnya. Hanya arsip lengkap yang dibuat oleh TerasDocs yang dapat dipulihkan; snapshot otomatis bersifat parsial dan hanya tersedia untuk diunduh.

## Media dan lampiran

Gunakan tombol **Sisipkan media** pada editor halaman untuk mengunggah gambar, SVG, video, PDF, atau lampiran dokumen. File disimpan di `storage/uploads`, sedangkan metadata disimpan dalam `storage/media.json`. File tidak diekspos sebagai direktori statis dan hanya dilayani melalui URL `/media/<id>`.

Media Library juga dapat dibuka langsung dari tombol **Media** pada panel admin tanpa membuka editor halaman. Saat dibuka dari editor, Media Library menyediakan aksi **Sisipkan** dan mempertahankan posisi kursor. Saat dibuka dari panel admin, fokusnya adalah pengelolaan file.

Setiap file menampilkan status penggunaan dan halaman yang mereferensikannya. Pemeriksaan mencakup seluruh halaman tersimpan, termasuk draft. File yang masih digunakan tidak dapat dihapus. Admin dapat memfilter file yang tidak digunakan dan membersihkannya sekaligus; server selalu memeriksa ulang seluruh Markdown tepat sebelum penghapusan dan membuat snapshot otomatis terlebih dahulu.

Jika ditemukan file fisik di `storage/uploads` yang tidak terdaftar dalam `media.json`, Media Library menampilkan peringatan tetapi tidak menghapusnya secara otomatis. Perilaku konservatif ini mencegah kehilangan file akibat metadata yang rusak atau pemulihan yang belum lengkap. Sebaliknya, metadata yang file fisiknya hilang ditandai sebagai file bermasalah.

SVG dibersihkan sebelum disimpan. Embed video eksternal hanya menerima YouTube dan Vimeo. Ukuran maksimum file ditentukan oleh `MAX_UPLOAD_MB` dan secara default bernilai `50`.

Jangan mengekspos folder `storage` sebagai direktori statis melalui Nginx atau web server lain.

## Keamanan

- Jangan commit `.env`, isi `storage`, media unggahan, atau backup produksi. Pola tersebut sudah disertakan dalam `.gitignore`.
- Gunakan password admin yang panjang dan unik, lalu simpan hanya hasil hash-nya pada `ADMIN_PASSWORD_HASH`.
- Aktifkan HTTPS dan `COOKIE_SECURE=true` pada deployment publik.
- Jangan mengekspos port `3000` atau direktori `storage` langsung ke internet.
- Lakukan backup berkala dan uji proses pemulihannya.
- Session admin disimpan di memori dan akan berakhir ketika proses server dimulai ulang.
- Login dibatasi maksimal lima kegagalan per alamat IP dalam jendela 15 menit.

### Troubleshooting login

Jika login menampilkan pesan bahwa koneksi aman memerlukan HTTPS, berarti `COOKIE_SECURE=true` tetapi aplikasi sedang dibuka melalui HTTP. Gunakan alamat HTTPS pada deployment publik. Untuk pengembangan lokal melalui `http://localhost`, ubah menjadi:

```env
COOKIE_SECURE=false
```

Restart aplikasi setelah mengubah `.env`. Jangan menggunakan `COOKIE_SECURE=false` pada server publik yang sudah memiliki HTTPS. Jika aplikasi berada di belakang Nginx, pastikan header berikut diteruskan agar Express dapat mengenali koneksi HTTPS:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

Jika menemukan kerentanan, hindari mengirim kredensial, isi dokumen privat, atau data sensitif melalui issue publik.

## Kontribusi

Kontribusi dipersilakan melalui pull request:

1. Fork repository dan buat branch untuk perubahan Anda.
2. Install dependency dengan `npm ci`.
3. Implementasikan perubahan dengan cakupan yang jelas.
4. Jalankan `npm test` dan `npm run build`.
5. Buat pull request beserta ringkasan perubahan dan cara memverifikasinya.

Gunakan issue untuk laporan bug dan usulan fitur. Sertakan langkah reproduksi, perilaku yang diharapkan, serta versi Node.js dan metode deployment yang digunakan.
