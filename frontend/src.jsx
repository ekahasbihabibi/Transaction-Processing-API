import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

const demoUsers = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Alice' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Bob' },
]
const number = new Intl.NumberFormat('id-ID')
const date = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
const statusText = { completed: 'Berhasil', pending: 'Menunggu', failed: 'Gagal' }

async function api(path, { token, body, key } = {}) {
  const headers = {}
  if (token) headers.Authorization = 'Bearer ' + token
  if (key) headers['Idempotency-Key'] = key
  if (body) headers['Content-Type'] = 'application/json'
  let response
  try {
    response = await fetch('/api' + path, {
      headers,
      method: body ? 'POST' : 'GET',
      body: body && JSON.stringify(body),
    })
  } catch {
    throw new Error('Koneksi ke backend terputus. Coba lagi.')
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.success) {
    const message = payload?.error?.message || 'Backend tidak merespons sesuai format API. Cek localhost:3000/health.'
    throw Object.assign(new Error(message), { status: response.status })
  }
  return payload
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { data } = await api('/auth/login', { body: { email, password } })
      const token = data.accessToken
      const claims = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const id = JSON.parse(atob(claims)).sub
      const profile = await api('/users/' + id, { token })
      onLogin({ token, user: profile.data })
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return <main className="login">
    <section className="intro">
      <span className="eyebrow">RUANG TRANSAKSI</span>
      <h1>Kelola saldo dan transfer dalam satu tempat.</h1>
      <p>Pantau saldo, kirim dana, dan lihat riwayat transaksi dari akun Anda.</p>
    </section>
    <form className="card" onSubmit={submit}>
      <span className="eyebrow">AKSES AKUN</span>
      <h2>Masuk</h2>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Kata sandi<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setEmail('alice@example.com'); setPassword('Password123!') }}>Isi akun demo Alice</button>
    </form>
  </main>
}

function Dashboard({ session, onLogout }) {
  const { user, token } = session
  const [balance, setBalance] = useState(user.balance)
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [notice, setNotice] = useState('')
  const [transferError, setTransferError] = useState('')
  const [readError, setReadError] = useState('')
  const pending = useRef(null)
  const endpoint = '/users/' + user.id + '/balance'

  useEffect(() => {
    let active = true
    setLoading(true)
    setReadError('')
    Promise.all([api(endpoint, { token }), api('/transactions?page=' + page, { token })])
      .then(([saldo, history]) => {
        if (!active) return
        setBalance(saldo.data.balance)
        setRows(history.data)
        setPages(history.meta.totalPages)
      })
      .catch(error => {
        if (active) setReadError(error.status === 401 ? 'Sesi berakhir. Keluar lalu masuk kembali.' : error.message)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [endpoint, token, page, refresh])

  async function transfer(event) {
    event.preventDefault()
    setTransferError('')
    setNotice('')
    const body = { fromUserId: user.id, toUserId: recipient.trim(), amount: Number(amount) }
    if (!Number.isSafeInteger(body.amount) || body.amount < 1) {
      setTransferError('Nominal harus berupa bilangan bulat positif.')
      return
    }
    const fingerprint = JSON.stringify(body)
    if (pending.current?.fingerprint !== fingerprint) {
      pending.current = { fingerprint, key: crypto.randomUUID() }
    }
    setBusy(true)
    try {
      await api('/transfers', { token, body, key: pending.current.key })
      pending.current = null
      setAmount('')
      setNotice('Transfer berhasil.')
      setPage(1)
      setRefresh(value => value + 1)
    } catch (error) {
      if (error.status >= 400 && error.status < 500) pending.current = null
      if (error.status === 422) setRefresh(value => value + 1)
      setTransferError(error.status === 401 ? 'Sesi berakhir. Keluar lalu masuk kembali.' : error.message)
    } finally {
      setBusy(false)
    }
  }

  function accountName(id) {
    if (id === user.id) return 'Akun Anda'
    return demoUsers.find(account => account.id === id)?.name || id
  }

  return <main className="dashboard">
    <header className="welcome">
      <div><span className="eyebrow">DASHBOARD</span><h1>Halo, {user.name}</h1><p>{user.email}</p></div>
      <button className="secondary" onClick={onLogout} disabled={busy}>Keluar</button>
    </header>
    <div className="grid">
      <section className="balance">
        <span className="eyebrow">SALDO TERSEDIA</span>
        <strong>{number.format(BigInt(balance))}</strong>
        <span className="caption">ID akun</span>
        <code>{user.id}</code>
      </section>
      <form className="card" onSubmit={transfer}>
        <h2>Kirim dana</h2>
        <label>ID penerima<input required value={recipient} disabled={busy} onChange={event => setRecipient(event.target.value)} placeholder="Masukkan UUID penerima" /></label>
        <div className="chips">{demoUsers.filter(account => account.id !== user.id).map(account =>
          <button key={account.id} type="button" disabled={busy} onClick={() => setRecipient(account.id)}>{account.name} · demo</button>
        )}</div>
        <label>Nominal<input type="number" min="1" step="1" required value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} placeholder="Contoh 10000" /></label>
        {transferError && <p className="error" role="alert">{transferError}</p>}
        {notice && <p className="success" role="status">{notice}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Mengirim…' : 'Kirim transfer'}</button>
      </form>
    </div>
    <section className="card history">
      <div className="history-head"><h2>Riwayat transaksi</h2><button className="secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Muat ulang</button></div>
      {loading && <p role="status">Memuat transaksi…</p>}
      {readError && <p className="error" role="alert">{readError}</p>}
      {!loading && !readError && (rows.length ? <>
        <div className="table-wrap"><table>
          <thead><tr><th>Waktu</th><th>Pengirim</th><th>Penerima</th><th>Nominal</th><th>Status</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td>{date.format(new Date(row.createdAt))}</td><td>{accountName(row.fromUserId)}</td><td>{accountName(row.toUserId)}</td>
            <td>{number.format(BigInt(row.amount))}</td><td><span className={'badge ' + row.status}>{statusText[row.status] || row.status}</span></td>
          </tr>)}</tbody>
        </table></div>
        {pages > 1 && <div className="pager">
          <button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Sebelumnya</button>
          <span>{page} / {pages}</span>
          <button className="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Berikutnya</button>
        </div>}
      </> : <p>Belum ada transaksi.</p>)}
    </section>
  </main>
}

function App() {
  const [session, setSession] = useState(null)
  return <>
    <nav className="top"><span className="logo" aria-hidden="true">↔</span> Transaction Desk</nav>
    {session ? <Dashboard session={session} onLogout={() => setSession(null)} /> : <Login onLogin={setSession} />}
  </>
}

createRoot(document.getElementById('root')).render(<App />)
