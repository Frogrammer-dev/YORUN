import { redirect } from "next/navigation";
import { AppHub } from "@/components/AppHub";
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { code } = await searchParams;
  if (typeof code === "string") redirect(`/auth/callback?code=${encodeURIComponent(code)}&next=%2Froom`);
  return <AppHub section="dashboard" />;
}
