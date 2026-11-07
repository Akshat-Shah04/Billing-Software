import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import Layout from "./components/Layout";
import BillForm from "./pages/BillForm";
import BillView from "./pages/BillView";
import Bills from "./pages/Bills";
import Clients from "./pages/Clients";
import Login from "./pages/Login";
import Services from "./pages/Services";
import SettingsPage from "./pages/SettingsPage";
import Staff from "./pages/Staff";

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted" style={{ padding: "2rem" }}>Loading…</p>;
  if (!user) return <Login />;

  const isAdmin = user.role === "admin";
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/bills" element={<Bills />} />
        <Route path="/bills/new" element={<BillForm />} />
        <Route path="/bills/:id" element={<BillView />} />
        <Route path="/bills/:id/edit" element={<BillForm />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/services" element={<Services />} />
        {isAdmin && <Route path="/staff" element={<Staff />} />}
        {isAdmin && <Route path="/settings" element={<SettingsPage />} />}
        <Route path="*" element={<Navigate to="/bills" replace />} />
      </Route>
    </Routes>
  );
}
