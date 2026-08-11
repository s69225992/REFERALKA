import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Рефералка — кабинет",
  description: "Реферальная программа для водителей таксопарка",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
