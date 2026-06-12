// Root layout — next-intl middleware redirects all requests to /[locale]/*
// This shell is required by Next.js App Router.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
