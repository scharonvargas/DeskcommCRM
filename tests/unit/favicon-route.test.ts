// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const marcaDaInstalacao = vi.hoisted(() => vi.fn());
vi.mock("@/lib/branding/instalacao", () => ({ marcaDaInstalacao }));

const { GET } = await import("@/app/favicon.ico/route");

describe("GET /favicon.ico", () => {
  beforeEach(() => {
    marcaDaInstalacao.mockReset().mockResolvedValue(null);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("redireciona ao ícone dinâmico sem exigir sessão", async () => {
    const resposta = await GET();
    expect(resposta.status).toBe(307);
    expect(resposta.headers.get("location")).toBe("/icon");
    expect(resposta.headers.get("cache-control")).toBe("no-store");
  });

  it("preserva o favicon configurado na instalação", async () => {
    marcaDaInstalacao.mockResolvedValue({ favicon_path: "platform/icone.png" });
    const resposta = await GET();
    expect(resposta.headers.get("location")).toBe(
      "http://localhost:54321/storage/v1/object/public/brand-logos/platform/icone.png",
    );
  });

  it("acompanha a troca do ícone sem guardar um redirect antigo", async () => {
    await GET();
    marcaDaInstalacao.mockResolvedValue({ favicon_path: "platform/outro.png" });
    const resposta = await GET();
    expect(marcaDaInstalacao).toHaveBeenCalledTimes(2);
    expect(resposta.headers.get("location")).toBe(
      "http://localhost:54321/storage/v1/object/public/brand-logos/platform/outro.png",
    );
    expect(resposta.headers.get("cache-control")).toBe("no-store");
  });
});
