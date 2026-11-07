import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import BrandMark from "./BrandMark";
import Icon, { type IconName } from "./Icon";
import ThemeToggle from "./ThemeToggle";

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default function Layout() {
  const { user, logout } = useAuth();
  const links: [string, string, IconName][] = [
    ["/bills", "Bills", "bills"],
    ["/clients", "Clients", "clients"],
    ["/services", "Services", "services"],
  ];
  if (user?.role === "admin") links.push(["/staff", "Staff", "staff"], ["/settings", "Settings", "settings"]);

  return (
    <div className="app">
      {/* Functional layer: translucent sidebar. Account controls sit right under the menu, not at the window's bottom. */}
      <aside className="sidebar material">
        <NavLink to="/bills" className="brand">
          <BrandMark size={30} />
          <span>
            Billing Software
            <small>Bills, payments and clients</small>
          </span>
        </NavLink>

        <nav className="nav" aria-label="Main">
          {links.map(([to, label, icon]) => (
            <NavLink key={to} to={to}>
              <Icon name={icon} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="account">
          <div className="account-who">
            <span className="avatar" aria-hidden="true">
              {initials(user?.full_name)}
            </span>
            <span className="account-name" title={user?.full_name}>
              {user?.full_name}
              <small>{user?.role}</small>
            </span>
          </div>
          <div className="account-row">
            <ThemeToggle />
            <button className="icon-only" onClick={logout} aria-label="Log out" title="Log out">
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>
      <div className="content">
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
