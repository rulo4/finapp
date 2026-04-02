import { useState } from 'react';
import { getSupabaseConfig, supabase } from '../lib/supabase/client';

type AuthPageMode = 'auth' | 'loading' | 'config-error';

export function AuthPage({ mode }: { mode: AuthPageMode }) {
  const [variant, setVariant] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { url, anonKeyLoaded } = getSupabaseConfig();

  if (mode === 'loading') {
    return (
      <div className="auth-shell">
        <section className="auth-card">
          <div className="auth-card__header">
            <span className="auth-card__eyebrow">Finapp</span>
            <h1 className="sidebar__title">Cargando</h1>
          </div>
        </section>
      </div>
    );
  }

  if (mode === 'config-error') {
    return (
      <div className="auth-shell">
        <section className="auth-card">
          <div className="auth-card__header">
            <span className="auth-card__eyebrow">Finapp</span>
            <h1 className="sidebar__title">Config faltante</h1>
          </div>
          <div className="status-list">
            <div className="status-row">
              <span className="status-row__label">Project URL</span>
              <span className="status-row__value">{url || 'No definida'}</span>
            </div>
            <div className="status-row">
              <span className="status-row__label">Anon key</span>
              <span className="status-row__value">{anonKeyLoaded ? 'Cargada' : 'Faltante'}</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setMessage('Supabase no esta disponible en este entorno.');
      return;
    }

    setIsSubmitting(true);

    if (variant === 'sign-in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      setMessage(error ? `No fue posible iniciar sesion: ${error.message}` : 'Sesion iniciada correctamente.');
      setIsSubmitting(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setMessage(`No fue posible crear la cuenta: ${error.message}`);
      setIsSubmitting(false);
      return;
    }

    if (data.session) {
      setMessage('Cuenta creada y sesion iniciada.');
    } else {
      setMessage('Cuenta creada. Espera el correo para confirmar tu cuenta y revisa spam si no lo ves.');
    }

    setIsSubmitting(false);
  }

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="auth-card__header">
          <span className="auth-card__eyebrow">Finapp</span>
          <h1 className="sidebar__title">{variant === 'sign-in' ? 'Entrar' : 'Crear cuenta'}</h1>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="correo@ejemplo.com"
              required
            />
          </label>

          <label className="auth-field">
            <span>Clave</span>
            <input
              type="password"
              autoComplete={variant === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Min. 6 caracteres"
              minLength={6}
              required
            />
          </label>

          <div className="auth-actions">
            <button className="auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Procesando...' : variant === 'sign-in' ? 'Entrar' : 'Crear'}
            </button>
            <button
              className="auth-switch"
              type="button"
              onClick={() => {
                const nextVariant = variant === 'sign-in' ? 'sign-up' : 'sign-in';
                setVariant(nextVariant);
                setMessage('');
              }}
            >
              {variant === 'sign-in' ? 'Crear cuenta' : 'Ya tengo cuenta'}
            </button>
          </div>
        </form>

        {message ? <p className="inline-hint">{message}</p> : null}
      </section>
    </div>
  );
}