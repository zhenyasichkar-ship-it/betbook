import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Betbook",
  description: "Навчальна рулетка з ботами й віртуальними ставками."
};

export const viewport: Viewport = { viewportFit: "cover", themeColor: "#100a18" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js?65" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
