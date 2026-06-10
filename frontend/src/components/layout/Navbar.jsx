// frontend/src/components/layout/Navbar.jsx

import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { healthCheck } from '../../api/client';

const navItems = [
  { label: 'STOCK OPT',   path: '/sto'          },
  { label: 'STOCK FUT',   path: '/stf'          },
  { label: 'INDEX OPT',   path: '/ido'          },
  { label: 'INDEX FUT',   path: '/idf'          },
  { label: 'STOCKS',      path: '/stocks'       },
  { label: 'MARKET',      path: '/market'       },
  { label: 'PARTICIPANTS',path: '/participants'  },
  { label: 'FII',         path: '/fii'          },
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
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {/* Inject IBM Plex Mono once at the top level */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { font-family: 'IBM Plex Mono', 'Courier New', monospace; }
      `}</style>

      <header
        style={{ background: '#080b0f', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        className="sticky top-0 z-50 h-[52px]"
      >
        <div className="h-full px-4 flex items-center justify-between gap-6">

          {/* Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <div style={{ borderRight: '1px solid rgba(255,255,255,0.12)' }} className="pr-3">
              <span
                style={{ color: '#F5A623', letterSpacing: '0.12em', fontSize: '15px', fontWeight: 600 }}
              >
                CANDL
              </span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px', letterSpacing: '0.1em' }}>
              NSE ANALYTICS
            </span>
          </div>

          {/* Nav */}
          <nav className="flex items-center gap-0 overflow-x-auto flex-1">
            {navItems.map((item, i) => (
              <NavLink
                key={item.path}
                to={item.path}
                style={({ isActive }) => ({
                  padding: '0 12px',
                  height: '52px',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '12px',
                  fontWeight: 500,
                  letterSpacing: '0.08em',
                  borderRight: i < navItems.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  borderBottom: isActive ? '2px solid #F5A623' : '2px solid transparent',
                  color: isActive ? '#F5A623' : 'rgba(255,255,255,0.75)',
                  background: isActive ? 'rgba(245,166,35,0.05)' : 'transparent',
                  transition: 'color 0.15s, background 0.15s',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Status */}
          <div className="flex items-center gap-2 shrink-0">
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background:
                  backendStatus === 'online'  ? '#00C896' :
                  backendStatus === 'offline' ? '#E05252' : '#F5A623',
              }}
            />
            <span style={{ fontSize: '10px', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.3)' }}>
              {backendStatus === 'online'   ? 'LIVE'    :
               backendStatus === 'offline'  ? 'OFFLINE' : 'CONNECTING'}
            </span>
          </div>

        </div>
      </header>
    </>
  );
}