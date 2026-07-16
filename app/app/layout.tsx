import type { Metadata } from "next";
import { Changa, Readex_Pro } from "next/font/google";
import "./globals.css";

// Display: Changa — condensed Arabic authority for headlines and big numerals.
// Body: Readex Pro — open, readable, warmer than the usual Cairo/Tajawal defaults.
const changa = Changa({
  weight: ["600", "700", "800"],
  subsets: ["arabic", "latin"],
  variable: "--font-changa",
});

const readex = Readex_Pro({
  weight: ["300", "400", "500", "600"],
  subsets: ["arabic", "latin"],
  variable: "--font-readex",
});

export const metadata: Metadata = {
  title: "MindTheLeak — اكتشف تسريباتك المالية",
  description:
    "نظام ذكاء مالي يكشف تسريباتك المالية قبل أن تغرق ميزانيتك — يفسّر سلوكك، لا أرقامك فقط.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${changa.variable} ${readex.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans bg-navy text-fg">
        {children}
      </body>
    </html>
  );
}
