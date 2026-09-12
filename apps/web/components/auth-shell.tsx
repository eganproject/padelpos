import { Brand } from "./brand";
import { Activity, ShieldCheck, Sparkles } from "lucide-react";

export function AuthShell({ children, mode }: { children: React.ReactNode; mode: "login" | "register" }) {
  return (
    <main className="auth-page">
      <div className="grid-overlay" />
      <section className="auth-story">
        <Brand />
        <div className="story-copy">
          <div className="eyebrow"><span /> COURT MANAGEMENT, REIMAGINED</div>
          <h1>Kelola permainan.<br /><em>Kuasai arena.</em></h1>
          <p>Platform operasional terpadu untuk bisnis padel modern. Satu dashboard untuk booking, lapangan, member, dan pertumbuhan.</p>
          <div className="feature-strip">
            <div><Activity /><span><b>Real-time</b> Court overview</span></div>
            <div><ShieldCheck /><span><b>Secure</b> Protected access</span></div>
            <div><Sparkles /><span><b>Effortless</b> Smart operations</span></div>
          </div>
        </div>
        <div className="court-art" aria-hidden="true">
          <div className="court-glow" /><div className="court"><i /><b /><span /></div>
          <div className="ball" />
        </div>
        <p className="story-footer">© 2026 PADELIX SYSTEMS <span>JAKARTA, ID</span></p>
      </section>
      <section className="auth-panel">
        <div className="mobile-brand"><Brand compact /></div>
        <div className="auth-card">
          <div className="step-label">{mode === "login" ? "SECURE ACCESS" : "CREATE OPERATOR ID"}</div>
          {children}
        </div>
        <p className="secure-note"><ShieldCheck size={14} /> 256-BIT ENCRYPTED CONNECTION</p>
      </section>
    </main>
  );
}
