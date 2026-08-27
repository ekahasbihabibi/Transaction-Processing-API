# Panduan Memahami dan Menjelaskan Backend Task

Dokumen ini membantu Anda menjalankan proyek, memahami setiap keputusan teknis, dan menjelaskannya saat wawancara. Jangan hanya menghafal kalimatnya; pahami urutan logikanya.

## 1. Apa yang diminta perusahaan?

Anda diminta membuat API yang mempunyai tiga kemampuan utama:

1. Mengelola pengguna dan saldo.
2. Memindahkan saldo antar-pengguna dengan aman.
3. Menampilkan riwayat transaksi.

Perusahaan tidak hanya menilai apakah endpoint memberikan respons. Mereka ingin melihat apakah sistem tetap benar ketika request gagal, dikirim berulang, atau masuk bersamaan.

## 2. Konsep penting dalam bahasa sederhana

### Atomic transaction

Transfer terdiri dari tiga perubahan: saldo pengirim berkurang, saldo penerima bertambah, dan riwayat transaksi menjadi `completed`. Ketiganya harus dianggap sebagai satu paket.

- Jika semuanya berhasil, database melakukan `COMMIT`.
- Jika salah satu gagal, database melakukan `ROLLBACK`.

Akibatnya, tidak ada keadaan saldo pengirim sudah berkurang tetapi saldo penerima belum bertambah.

### Concurrency dan row locking

Bayangkan saldo Alice 100.000. Dua request masing-masing ingin mengirim 80.000 pada waktu hampir sama. Tanpa penguncian, keduanya mungkin sama-sama membaca saldo 100.000 lalu sama-sama berhasil.

Proyek ini menggunakan `SELECT ... FOR UPDATE`. Request pertama mengunci baris Alice. Request kedua menunggu. Setelah request pertama selesai, request kedua membaca saldo terbaru 20.000 dan gagal karena tidak cukup.

Baris pengirim dan penerima selalu dikunci berdasarkan urutan UUID. Urutan tetap ini mencegah dua transfer yang berlawanan saling menunggu tanpa akhir atau deadlock.

### Idempotency

Jaringan dapat terputus setelah server memproses transfer tetapi sebelum aplikasi menerima respons. Aplikasi kemudian mengirim ulang request. Tanpa idempotency, saldo bisa terpotong dua kali.

Klien mengirim header seperti:

```http
Idempotency-Key: transfer-12345
```

Sistem menyimpan key tersebut bersama transaksi. Jika pengirim mengulang key dan isi transfer yang sama, sistem mengembalikan transaksi lama tanpa memotong saldo lagi. Jika key yang sama digunakan untuk isi berbeda, sistem mengembalikan konflik `409`.

### Authentication dan authorization

- Authentication menjawab: "Siapa Anda?" Proyek menggunakan JWT.
- Authorization menjawab: "Apa yang boleh Anda lakukan?"

Pengguna biasa hanya boleh mengirim dari rekeningnya sendiri dan melihat profil, saldo, serta transaksi yang melibatkan dirinya. Admin boleh melihat data lintas pengguna.

### BIGINT untuk uang

Uang tidak disimpan sebagai bilangan pecahan. Nilai `10000` berarti 10.000 unit terkecil mata uang. PostgreSQL menggunakan `BIGINT`. Respons mengirim nilai uang sebagai string agar JavaScript tidak melakukan pembulatan diam-diam pada angka yang sangat besar.

## 3. Alur transfer dalam kode

Fokus utama berada di `src/modules/transfers/service.ts`.

Urutannya:

1. Mulai database transaction dengan `BEGIN`.
2. Ambil advisory lock berdasarkan ID pengirim dan idempotency key.
3. Cari transaksi lama dengan key yang sama.
4. Jika ditemukan, cocokkan fingerprint request.
5. Kunci baris pengirim dan penerima dengan `FOR UPDATE` dalam urutan UUID.
6. Pastikan kedua pengguna ada.
7. Simpan transaksi berstatus `pending`.
8. Jika saldo kurang, ubah status menjadi `failed`, jangan ubah saldo, lalu `COMMIT`.
9. Jika cukup, kurangi saldo pengirim dengan syarat tambahan `balance >= amount`.
10. Tambah saldo penerima.
11. Ubah transaksi menjadi `completed`.
12. `COMMIT` seluruh perubahan.
13. Jika terjadi error yang tidak ditangani, lakukan `ROLLBACK`.

Perlindungannya berlapis: validasi aplikasi, row lock, kondisi atomik saat debit, constraint saldo non-negatif, dan unique constraint untuk idempotency.

## 4. Struktur database

### Tabel `users`

- `id`: UUID primary key.
- `email`: unik dan harus huruf kecil.
- `password_hash`: hasil `scrypt`, bukan password asli.
- `balance`: `BIGINT`, tidak boleh negatif.
- `role`: hanya `user` atau `admin`.
- `version`: bertambah setiap saldo berubah.
- `created_at` dan `updated_at`: waktu audit dasar.

### Tabel `transactions`

- Menyimpan pengirim, penerima, nilai, status, dan waktu.
- Foreign key memastikan pengguna valid.
- Sender tidak boleh sama dengan receiver.
- Amount harus positif.
- Idempotency key unik untuk setiap pengirim.
- Fingerprint mengikat key pada isi request.
- Failure code dan failure message mencatat kegagalan bisnis.
- Constraint memastikan status cocok dengan `completed_at` atau `failed_at`.

## 5. Cara menjalankan paling mudah

Pastikan Docker Desktop aktif, lalu jalankan dari folder proyek:

```bash
docker compose up --build -d
docker compose ps
```

Cek server:

```bash
curl http://localhost:3000/health
```

Jika responsnya `{"status":"ok"}`, API dan database sudah terhubung.

## 6. Urutan demonstrasi saat presentasi

1. Tunjukkan `README.md` dan struktur folder.
2. Jalankan `docker compose up --build -d`.
3. Buka `/health`.
4. Login sebagai Alice.
5. Periksa saldo Alice dan Bob.
6. Transfer 10.000 dari Alice ke Bob.
7. Ulangi request dengan idempotency key yang sama.
8. Buktikan transaction ID sama dan saldo hanya berubah sekali.
9. Coba transfer melebihi saldo dan tunjukkan status `failed`.
10. Jalankan `npm test` dan jelaskan concurrency test.

Gunakan `docs/requests.http` dengan ekstensi REST Client di VS Code agar demonstrasi lebih praktis.

## 7. Jawaban singkat untuk pertanyaan wawancara

### Mengapa memilih PostgreSQL?

"PostgreSQL memiliki transaksi ACID, row-level locking, constraint yang kuat, serta advisory lock. Kemampuan itu langsung mendukung kebutuhan konsistensi saldo, concurrency, dan idempotency pada tugas ini."

### Bagaimana Anda mencegah saldo negatif?

"Saya mengunci baris pengguna dengan `FOR UPDATE`, mengecek saldo setelah lock diperoleh, melakukan debit dengan kondisi `balance >= amount`, dan menambahkan constraint database `balance >= 0`. Jadi perlindungannya tidak hanya berada di aplikasi."

### Mengapa tidak cukup mengecek saldo di JavaScript?

"Dua request dapat membaca saldo lama secara bersamaan. Pemeriksaan aplikasi tanpa lock memiliki celah race condition. Karena itu keputusan akhir dilakukan di dalam transaksi database saat baris telah dikunci."

### Bagaimana idempotency bekerja?

"Key disimpan secara unik per pengirim. Advisory lock membuat request paralel dengan key sama diproses bergantian. Fingerprint memastikan key tidak dipakai untuk payload berbeda. Retry yang identik mengembalikan transaksi lama tanpa debit ulang."

### Mengapa menggunakan JWT?

"JWT sederhana untuk API stateless dan cukup untuk lingkup assessment. Token berisi ID dan role pengguna. Untuk produksi saya akan menambahkan refresh token, rotasi secret atau asymmetric key, serta mekanisme revocation."

### Mengapa failed transfer tetap disimpan?

"Riwayat gagal membantu audit, troubleshooting, dan idempotent retry. Untuk saldo tidak cukup, transaksi `failed` dikomit tanpa perubahan saldo."

### Apa yang akan diperbaiki untuk produksi?

"Saya akan menggunakan double-entry ledger, rate limiting, MFA, key rotation, metrics dan tracing, outbox untuk event, rekonsiliasi, backup drill, serta proses deposit yang diaudit."

### Bagaimana sistem ini dapat di-scale?

"API dapat direplikasi secara horizontal karena state utama berada di PostgreSQL dan JWT. Idempotency serta locking tetap bekerja lintas instance. Untuk skala lebih besar, riwayat baca dapat dipisah ke read model, koneksi memakai pooler, dan partisi transaksi diterapkan berdasarkan kebutuhan."

## 8. Error yang perlu dikenali

| Kode | Arti |
| --- | --- |
| `VALIDATION_ERROR` | Bentuk atau nilai input salah |
| `UNAUTHORIZED` | Token tidak ada atau tidak valid |
| `FORBIDDEN` | Pengguna mencoba mengakses data milik orang lain |
| `USER_NOT_FOUND` | Pengirim atau penerima tidak ditemukan |
| `SAME_USER_TRANSFER` | Pengirim dan penerima sama |
| `INSUFFICIENT_BALANCE` | Saldo pengirim tidak cukup |
| `IDEMPOTENCY_KEY_REUSED` | Key lama digunakan untuk request yang berbeda |
| `CONCURRENT_BALANCE_CHANGE` | Saldo berubah dan request perlu dicoba ulang |
| `INTERNAL_SERVER_ERROR` | Error internal yang detailnya sengaja tidak dibuka |

## 9. Checklist sebelum dikirim

- Ganti placeholder URL repository di platform submission.
- Jalankan `npm ci` dari keadaan bersih.
- Jalankan `npm run typecheck`.
- Jalankan `npm test` dengan PostgreSQL test aktif.
- Jalankan `npm run build`.
- Jalankan Docker Compose dari volume bersih.
- Pastikan `.env` tidak masuk Git.
- Periksa `git status` untuk secret atau file yang tidak perlu.
- Baca ulang `AI-USAGE.md` dan pastikan Anda dapat menjelaskan isinya.
- Coba jelaskan alur transfer tanpa melihat catatan.

Jika Anda dapat menjelaskan bagian 2 dan 3 dengan bahasa sendiri, Anda sudah memegang inti tugas ini.
