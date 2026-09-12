"use client";

import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { forwardRef, useState } from "react";

export const PasswordField = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function PasswordField(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-wrap">
      <LockKeyhole size={18} />
      <input {...props} ref={ref} type={visible ? "text" : "password"} />
      <button type="button" className="eye-button" onClick={() => setVisible((v) => !v)} aria-label="Tampilkan password">
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
});
