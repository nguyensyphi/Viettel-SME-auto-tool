import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "AM Viettel SME | Nội bộ",
  description: "Không gian quản lý lead, import và tác vụ nội bộ.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
