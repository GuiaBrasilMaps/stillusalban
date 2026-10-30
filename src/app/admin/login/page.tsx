'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AdminLoginPage() {
  const router = useRouter();
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [hasAnyAdminUser, setHasAnyAdminUser] = useState(true);
  const [jwtSecretConfigured, setJwtSecretConfigured] = useState(true);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/auth')
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) {
          router.replace('/admin');
          return;
        }
        setHasAnyAdminUser(Boolean(data.hasAnyAdminUser));
        setJwtSecretConfigured(Boolean(data.jwtSecretConfigured));
      })
      .catch(() => {
        setErrorMsg('Não foi possível verificar o estado da autenticação.');
      })
      .finally(() => setLoadingStatus(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const action = hasAnyAdminUser ? 'login' : 'bootstrap';
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          name: hasAnyAdminUser ? undefined : name,
          email,
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Falha na autenticação.');
        return;
      }

      router.push('/admin');
      router.refresh();
    } catch {
      setErrorMsg('Erro de comunicação com o servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F4] flex flex-col justify-center items-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-[#262626] bg-[#141414] p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="text-center border-b border-[#262626] pb-4">
          <span className="text-xs uppercase tracking-[0.25em] text-[#C5A059] block">
            Acesso Administrativo
          </span>
          <h1 className="text-2xl font-serif tracking-[0.16em] text-[#D4AF37] font-semibold mt-1">
            STILLUS ALBAN
          </h1>
        </div>

        {loadingStatus ? (
          <p className="text-sm text-center text-[#A8A29E] py-6">
            Carregando...
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {!hasAnyAdminUser && (
              <div>
                <label
                  htmlFor="admin-name"
                  className="block text-xs uppercase tracking-wider text-[#F5F5F4] mb-1.5"
                >
                  Nome do Administrador *
                </label>
                <input
                  id="admin-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3.5 py-2.5 text-sm text-[#F5F5F4]"
                  placeholder="Gestão Stillus Alban"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="admin-email"
                className="block text-xs uppercase tracking-wider text-[#F5F5F4] mb-1.5"
              >
                E-mail *
              </label>
              <input
                id="admin-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3.5 py-2.5 text-sm text-[#F5F5F4]"
                placeholder="seu@email.com.br"
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="block text-xs uppercase tracking-wider text-[#F5F5F4] mb-1.5"
              >
                Senha *
              </label>
              <input
                id="admin-password"
                type="password"
                required
                minLength={8}
                autoComplete={hasAnyAdminUser ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3.5 py-2.5 text-sm text-[#F5F5F4]"
              />
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-lg border border-[#EF4444]/50 bg-[#EF4444]/10 p-3 text-xs text-[#EF4444]"
              >
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !jwtSecretConfigured}
              className="w-full min-h-[44px] rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] disabled:opacity-50 text-[#0A0A0A] font-semibold text-sm transition cursor-pointer"
            >
              {submitting
                ? 'Autenticando...'
                : hasAnyAdminUser
                ? 'Entrar'
                : 'Cadastrar Administrador'}
            </button>
          </form>
        )}

        <div className="pt-2 border-t border-[#262626] text-center">
          <Link
            href="/"
            className="text-xs text-[#C5A059] hover:text-[#D4AF37] underline underline-offset-4"
          >
            Voltar para a página inicial da loja
          </Link>
        </div>
      </div>
    </div>
  );
}
