import Header from "@/components/Header";
import TabNav from "@/components/TabNav";

/**
 * App shell without the auth gate: the live Tournament tab is public per
 * SPEC ("Live data tab — read-only real data"). Signed-out visitors keep the
 * tab bar; gated tabs redirect to sign-in via the (app) layout.
 */
export default function PublicAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-pitch-950">
      <Header />
      <TabNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24 md:pb-10">
        {children}
      </main>
    </div>
  );
}
