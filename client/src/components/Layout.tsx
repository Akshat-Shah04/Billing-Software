import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import BrandMark from "./BrandMark";
import ThemeToggle from "./ThemeToggle";

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <NavLink to="/bills" className="brand">
          <BrandMark />
          <span>Billing Software</span>
        </NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/bills">Bills</NavLink>
          <NavLink to="/clients">Clients</NavLink>
          <NavLink to="/services">Services</NavLink>
          {user?.role === "admin" && <NavLink to="/staff">Staff</NavLink>}
          {user?.role === "admin" && <NavLink to="/settings">Settings</NavLink>}
        </nav>
        <div className="user-box">
          <ThemeToggle />
          <span className="user-name" title={user?.full_name}>
            {user?.full_name}
          </span>
          <span className="badge">{user?.role}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
