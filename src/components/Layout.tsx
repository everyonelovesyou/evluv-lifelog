import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { signOut } from "../features/auth/api";

export function Layout() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <div className="layout">
      <header className="app-header">
        <span className="app-title">生活ログ</span>
        <nav>
          <NavLink to="/" end>
            今日の記録
          </NavLink>
          <NavLink to="/items">項目管理</NavLink>
        </nav>
        <button type="button" className="signout" onClick={handleSignOut}>
          ログアウト
        </button>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
