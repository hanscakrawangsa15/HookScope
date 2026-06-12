"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Search, BarChart2, GitCompare, Shield, Code2, Hexagon, Activity } from "lucide-react";

const NAV_ITEMS = [
  { href: "/",           label: "Explorer",   icon: Search    },
  { href: "/compare",    label: "Compare",    icon: GitCompare },
  { href: "/arbitrage",  label: "Arbitrage",  icon: Activity  },
  { href: "/security",   label: "Security",   icon: Shield    },
  { href: "/developer",  label: "Dev Tools",  icon: Code2     },
  { href: "/stats",      label: "Stats",      icon: BarChart2  },
];

export function Navbar() {
  const path = usePathname();

  return (
    <header className="sticky top-0 z-50"
      style={{
        background: "rgba(8,11,18,0.80)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-black text-lg shrink-0 group">
            <div className="relative">
              <Hexagon size={24} className="text-blue-500 group-hover:text-blue-400 transition-colors" fill="rgba(59,130,246,0.15)" />
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-blue-300">HS</span>
            </div>
            <span className="gradient-text text-xl">HookScope</span>
          </Link>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-0.5">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = path === href;
              return (
                <Link
                  key={href}
                  href={href as string}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200",
                    active
                      ? "text-white"
                      : "text-gray-400 hover:text-gray-200"
                  )}
                  style={active ? {
                    background: "rgba(59,130,246,0.12)",
                    border: "1px solid rgba(59,130,246,0.25)",
                  } : {}}
                >
                  <Icon size={14} />
                  {label}
                  {active && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-400" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="https://github.com/your-org/hookscope"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </a>

            {/* Live indicator */}
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 px-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="hidden sm:inline">Live</span>
            </div>
          </div>

        </div>
      </div>
    </header>
  );
}
