import React, { useState } from 'react'
import { supabase } from './supabase'

const DOMAIN = '@omniamarketing.com.br'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e?.preventDefault()
    const em = email.trim().toLowerCase()
    if (!em.endsWith(DOMAIN)) { setErr('Use seu e-mail ' + DOMAIN); return }
    setBusy(true); setErr('')
    // login interno da equipe: sem senha pro usuário. A credencial técnica é o próprio e-mail.
    const key = em
    try {
      let { error } = await supabase.auth.signInWithPassword({ email: em, password: key })
      if (error) {
        const { error: eSignup } = await supabase.auth.signUp({ email: em, password: key })
        if (eSignup && !/already|registered|exists/i.test(eSignup.message)) throw eSignup
        const { error: eIn } = await supabase.auth.signInWithPassword({ email: em, password: key })
        if (eIn) throw eIn
      }
      // o onAuthStateChange no App renderiza o Home sozinho
    } catch (e2) {
      let m = e2?.message || 'Não deu pra entrar'
      if (/confirm/i.test(m)) m = 'Falta desativar "Confirm email" no Supabase (te passei como fazer).'
      else if (/credential/i.test(m)) m = 'Conta antiga — rode 1x o SQL que te passei e tente de novo.'
      setErr(m); setBusy(false)
    }
  }

  return (
    <div className="auth-bg">
      <div className="auth-inner">
        <div className="auth-brand"><img className="brand-img" src="/logo.png" alt="omnia.board" /></div>
        <div className="auth-card">
          <form onSubmit={submit}>
            <h1>Entrar</h1>
            <p>Quadro branco colaborativo da Omnia. É só colocar seu e-mail da empresa — sem senha, entra na hora.</p>
            <input autoFocus type="email" placeholder={'voce' + DOMAIN} value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} />
            {err && <div className="auth-err">{err}</div>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy} type="submit">{busy ? 'Entrando…' : 'Entrar'}</button>
          </form>
        </div>
      </div>
    </div>
  )
}
