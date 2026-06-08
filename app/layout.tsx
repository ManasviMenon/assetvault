import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CryptoProvider } from "@/contexts/CryptoContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Virasat",
  description: "Your family's financial vault",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <CryptoProvider>{children}</CryptoProvider>
      </body>
    </html>
  );
}
