"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Search, BarChart2, GitCompare, Shield, Code2 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/",          label: "Explorer",  icon: Search    },
  { href: "/compare",   label: "Compare",   icon: GitCompare },
  { href: "/security",  label: "Security",  icon: Shield    },
  { href: "/developer", label: "Dev Tools", icon: Code2     },
  { href: "/stats",     label: "Stats",     icon: BarChart2 },
];

export function Navbar() {
  const path = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0f0f10]/90 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-lg">
            <span className="text-2xl">🔍</span>
            <span className="text-white">Hook</span>
            <span className="text-blue-400">Scope</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  path === href
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
              >
                <Icon size={15} />
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href="https://github.com/your-org/hookscope"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost text-sm px-3 py-1.5"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
