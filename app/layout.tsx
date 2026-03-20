import type { Metadata } from "next";
import { Sora, Fraunces } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import NextTopLoader from "nextjs-toploader";
import { ThemeProvider } from "next-themes";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "UNIMONKS CUET Coaching",
  description:
    "UNIMONKS CUET Coaching offers a public free mock catalog, lead-capture based practice, and premium batch-assigned mock tests for enrolled students.",
  applicationName: "UNIMONKS CUET Coaching",
  keywords: [
    "UNIMONKS",
    "CUET coaching",
    "CUET mock tests",
    "free CUET mock test",
    "premium CUET practice",
    "CUET preparation",
  ],
  category: "education",
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: "UNIMONKS CUET Coaching",
    title: "UNIMONKS CUET Coaching",
    description:
      "Start with a free public CUET mock, then move into the premium batch-based practice flow when you are ready.",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "UNIMONKS CUET Coaching",
    description:
      "Public CUET mock tests with lead capture, instant score summaries, and a premium batch-only mock lane for enrolled students.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${sora.variable} ${fraunces.variable} font-sans antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <NextTopLoader color="#4F46E5" showSpinner={false} />
          {children}
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
