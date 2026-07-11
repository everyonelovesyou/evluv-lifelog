import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signIn, signUp } from "./api";

type Props = {
  mode: "login" | "signup";
};

export function AuthForm({ mode }: Props) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === "login";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-form">
      <h1>{isLogin ? "ログイン" : "新規登録"}</h1>
      <form onSubmit={handleSubmit}>
        <label>
          メールアドレス
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          パスワード
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? "current-password" : "new-password"}
            minLength={6}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {isLogin ? "ログイン" : "登録する"}
        </button>
      </form>
      <p>
        {isLogin ? (
          <Link to="/signup">新規登録はこちら</Link>
        ) : (
          <Link to="/login">ログインはこちら</Link>
        )}
      </p>
    </div>
  );
}
