# Transaction Desk

Frontend React untuk backend Transaction Processing API.

1. Jalankan backend dari folder proyek utama dengan `docker compose up -d --build`.
2. Buka http://localhost:3000/health. Pastikan hasilnya `{"status":"ok"}`.
3. Buka terminal baru, masuk ke folder `frontend`, lalu jalankan:

   ```powershell
   npm ci
   npm run dev
   ```

4. Buka alamat Local yang tampil di terminal, biasanya http://localhost:5173.
5. Klik **Isi akun demo Alice**, lalu klik **Masuk**. Untuk mencoba transfer, pilih **Bob · demo**, isi nominal, lalu klik **Kirim transfer**. Dashboard akan memuat ulang saldo dan riwayat.

Gunakan Node.js 22 atau lebih baru. Proxy Vite meneruskan request /api ke backend port 3000 saat pengembangan. Jika backend memakai port lain, sesuaikan target di vite.config.js. Untuk hosting hasil `npm run build`, konfigurasi server agar meneruskan /api ke backend dan menghapus awalan /api. Token disimpan dalam memori selama halaman terbuka, jadi refresh browser memerlukan login ulang.
