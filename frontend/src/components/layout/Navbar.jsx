// frontend/src/components/layout/Navbar.jsx

import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { healthCheck } from '../../api/client';

const navItems = [
  {
    label: 'Stock Options',
    path: '/sto'
  },
  {
    label: 'Stock Futures',
    path: '/stf'
  },
  {
    label: 'Index Options',
    path: '/ido'
  },
  {
    label: 'Index Futures',
    path: '/idf'
  },
  {
    label: 'Stocks',
    path: '/stocks'
  },
  {
    label: 'Market',
    path: '/market'
  },
  {
    label: 'Participants',
    path: '/participants'
  },
  {
    label: 'FII',
    path: '/fii'
  },
];

export default function Navbar() {

  const [backendStatus, setBackendStatus] = useState('checking');

  useEffect(() => {
    const check = async () => {
      try {
        await healthCheck();
        setBackendStatus('online');
      } catch {
        setBackendStatus('offline');
      }
    };

    check();

    const interval = setInterval(check, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <header
      className="
        sticky
        top-0
        z-50
        h-[64px]
        border-b
        border-white/10
        bg-[#11151d]/95
        backdrop-blur-md
      "
    >
      <div className="h-full px-6 flex items-center justify-between">
        {/* Left */}
        <div className="flex items-center gap-8">
          <div>
            <h1 className="text-lg font-bold tracking-wide text-white">
              NSE
            </h1>

            <p className="text-[11px] text-white/45">
              Asset Analytics Dashboard
            </p>
          </div>

          <nav className="flex items-center gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `
                    px-4
                    py-2
                    rounded-xl
                    text-sm
                    font-medium
                    transition-all
                    border
                    ${
                      isActive
                        ? `
                          bg-[#1a1d26]
                          border-[#00B0F0]/40
                          text-[#00B0F0]
                          shadow-[0_0_20px_rgba(0,176,240,0.12)]
                        `
                        : `
                          border-transparent
                          text-white/65
                          hover:text-white
                          hover:bg-white/5
                        `
                    }
                  `
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          <div
            className={`
              w-2.5
              h-2.5
              rounded-full
              ${
                backendStatus === 'online'
                  ? 'bg-emerald-400 animate-pulse'
                  : backendStatus === 'offline'
                  ? 'bg-red-500'
                  : 'bg-yellow-400 animate-pulse'
              }
            `}
          />

          <span className="text-xs text-white/50">
            {backendStatus === 'online'
              ? 'Backend Connected'
              : backendStatus === 'offline'
              ? 'Backend Offline'
              : 'Checking Backend...'}
          </span>
        </div>
      </div>
    </header>
  );
}