import { iconeDaAba } from "@/lib/branding/icone";
import { marcaDaInstalacao } from "@/lib/branding/instalacao";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const marca = await marcaDaInstalacao();
  return new Response(null, {
    status: 307,
    headers: {
      Location: iconeDaAba(marca?.favicon_path),
      "Cache-Control": "no-store",
    },
  });
}
