import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReflexRAG — Clinical Research Assistant",
  description: "Self-Reflection RAG for clinical research PDFs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent flash of wrong theme on load */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
