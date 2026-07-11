import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { LoginPage } from "./pages/LoginPage";
import { RecordItemsPage } from "./pages/RecordItemsPage";
import { SignUpPage } from "./pages/SignUpPage";
import { TodayPage } from "./pages/TodayPage";

function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <p className="loading">読み込み中…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<TodayPage />} />
            <Route path="/items" element={<RecordItemsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
