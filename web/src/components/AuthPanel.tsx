import type { SupabaseClient } from '@supabase/supabase-js'
import { useState } from 'react'

function explainAuthError(msg: string): string {
  const lower = msg.toLowerCase()
  if (lower.includes('anonymous')) {
    return (
      '服务端把本次请求当成了「匿名登录」，通常说明邮箱或密码没有有效提交（例如未填写、只打了空格、或浏览器自动填充未触发输入）。' +
      '请手打一遍邮箱和至少 6 位密码后再点注册。' +
      '若仍出现：打开 Supabase → Authentication → Providers → Email，确认 Email 已开启，且允许新用户注册（Sign up）。'
    )
  }
  return msg
}

export function AuthPanel({
  supabase,
  userEmail,
  onMessage,
  onDone,
}: {
  supabase: SupabaseClient
  userEmail: string | null
  onMessage: (s: string) => void
  onDone: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const validateCredentials = (): string | null => {
    const e = email.trim()
    if (!e) return '请填写邮箱。'
    if (!password) return '请填写密码。'
    if (password.length < 6) return '密码至少 6 位（Supabase 默认要求）。'
    return null
  }

  if (userEmail) {
    return (
      <div className="card">
        <p>
          已登录：<strong>{userEmail}</strong>
        </p>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            await supabase.auth.signOut()
            onMessage('ok: 已退出')
            onDone()
          }}
        >
          退出
        </button>
      </div>
    )
  }

  return (
    <div className="card">
      <p>
        邮箱注册/登录。请先在 Supabase → Authentication → Providers 里打开 <strong>Email</strong>，并允许新用户注册；本地开发请把
        http://localhost:5173 加到 Redirect URLs。
      </p>
      <div className="row">
        <label>
          邮箱
          <input
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            minLength={6}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <button
          type="button"
          onClick={async () => {
            const errText = validateCredentials()
            if (errText) {
              onMessage(errText)
              return
            }
            const redirect = `${window.location.origin}${window.location.pathname || '/'}`
            const { data, error } = await supabase.auth.signUp({
              email: email.trim(),
              password,
              options: { emailRedirectTo: redirect },
            })
            if (error) {
              onMessage(explainAuthError(error.message))
              return
            }
            if (data.session) {
              onMessage('ok: 注册成功，已登录')
            } else {
              onMessage(
                'ok: 账号已创建。若项目开启了「邮箱确认」，请先到邮箱点确认链接，再回到这里点「登录」。收不到邮件时：Supabase → Authentication → Providers → Email，可暂时关闭 Confirm email，仅用于本地开发。',
              )
            }
            onDone()
          }}
        >
          注册
        </button>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            const errText = validateCredentials()
            if (errText) {
              onMessage(errText)
              return
            }
            const { error } = await supabase.auth.signInWithPassword({
              email: email.trim(),
              password,
            })
            if (error) onMessage(explainAuthError(error.message))
            else {
              onMessage('ok: 已登录')
              onDone()
            }
          }}
        >
          登录
        </button>
      </div>
    </div>
  )
}
