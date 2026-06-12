import { setRequestLocale } from "next-intl/server";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import ChallengesSection from "@/components/ChallengesSection";
import Footer from "@/components/Footer";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="flex min-h-screen flex-col bg-pitch-950">
      <Header />
      <main className="flex flex-1 flex-col">
        <HeroSection />
        <ChallengesSection />
      </main>
      <Footer />
    </div>
  );
}
