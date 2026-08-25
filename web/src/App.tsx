
import { useEffect, lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useApp } from "./store";
import Login from "./pages/Login";
import Shell from "./layout/Shell";
import Dashboard from "./pages/Dashboard";
import Placeholder from "./pages/Placeholder";
import Settings from "./pages/Settings";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Tasks from "./pages/Tasks";
import Tables from "./pages/Tables";
import Docs from "./pages/Docs";
import Inventory from "./pages/Inventory";
import Carts from "./pages/Carts";
import CartDetail from "./pages/CartDetail";
import Orders from "./pages/Orders";

// Ciężkie strony ładowane leniwie (code splitting — mniejszy bundel startowy)
const Chat = lazy(() => import("./pages/Chat"));
const TablePage = lazy(() => import("./pages/TablePage"));
const DocEditor = lazy(() => import("./pages/DocEditor"));
const AiAssistant = lazy(() => import("./pages/AiAssistant"));

function PageLoader() {
  return <div className="page-loading"><span className="spinner" aria-hidden="true" />Ładowanie…</div>;
}

export default function App() {
  const booted = useApp((s) => s.booted);
  const user = useApp((s) => s.user);
  const boot = useApp((s) => s.boot);

  useEffect(() => { boot(); }, [boot]);

  useEffect(() => {
    const onAuthExpired = () => {
      useApp.getState().setUser(null);
      useApp.getState().setToken(null);
    };
    window.addEventListener("auth-expired", onAuthExpired);
    return () => window.removeEventListener("auth-expired", onAuthExpired);
  }, []);

  if (!booted) return <div className="boot-screen">🩺 Klinika CRM…</div>;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projekty" element={<Projects />} />
        <Route path="/projekty/:id" element={<ProjectDetail />} />
        <Route path="/zadania" element={<Tasks />} />
        <Route path="/komunikator" element={<Suspense fallback={<PageLoader />}><Chat /></Suspense>} />
        <Route path="/tabele" element={<Tables />} />
        <Route path="/tabele/:id" element={<Suspense fallback={<PageLoader />}><TablePage /></Suspense>} />
        <Route path="/dokumenty" element={<Docs />} />
        <Route path="/dokumenty/:id" element={<Suspense fallback={<PageLoader />}><DocEditor /></Suspense>} />
        <Route path="/inwentarz" element={<Inventory />} />
        <Route path="/koszyki" element={<Carts />} />
        <Route path="/koszyki/:id" element={<CartDetail />} />
        <Route path="/zamowienia" element={<Orders />} />
        <Route path="/ai" element={<Suspense fallback={<PageLoader />}><AiAssistant /></Suspense>} />
        <Route path="/ustawienia" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
