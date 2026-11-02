import { describe, expect, it, vi } from "vitest";
import { readBestAsk } from "./best-ask";

const PROCESS = "T".repeat(43);
const NODE = "https://node.test";
const ORDERS = "O".repeat(43);

const orderId = (n: number) => String(n).padStart(43, "x");

interface FakeOrder {
  asking: string;
  quantity: string;
  status?: string;
}

/** A node whose token has these orders; each order is its own message, as in a live HyperBEAM state. */
function fakeNode(orders: FakeOrder[], state: Record<string, string> = {}) {
  const messages = new Map<string, FakeOrder>(orders.map((order, i) => [orderId(i), order]));
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const head = (headers: Record<string, string>) => new Response(null, { status: 200, headers });
    if (url === `${NODE}/${PROCESS}~process@1.0/compute&max-age=60`) {
      return head({ "execution-device": "token@1.0", denomination: "12", orders: `ao:${ORDERS}`, ...state });
    }
    if (url === `${NODE}/${ORDERS}~message@1.0`) {
      return head(Object.fromEntries([...messages.keys()].map((id) => [id, `ao:${id}`])));
    }
    const status = url.match(/\/(x+\d*)~message@1\.0\/status$/)?.[1];
    if (status && init?.method !== "HEAD") return new Response(messages.get(status)?.status ?? "open");
    const id = url.match(/\/(x+\d*)~message@1\.0$/)?.[1];
    const order = id ? messages.get(id) : undefined;
    if (id && order) return head({ "order-id": id, asking: order.asking, quantity: order.quantity, status: "200" });
    return new Response("missing", { status: 404 });
  }) as unknown as typeof fetch;
}

const AR = 1_000_000_000_000n;

describe("readBestAsk", () => {
  it("returns the cheapest open ask in AR per whole token", async () => {
    const fetchImpl = fakeNode([
      { asking: String(4n * AR), quantity: String(2n * AR) }, // 2 AR per token
      { asking: String(3n * AR), quantity: String(6n * AR) }, // 0.5 AR per token
    ]);

    expect(await readBestAsk(PROCESS, NODE, fetchImpl)).toEqual({ arPerToken: 0.5 });
  });

  it("skips orders that aren't open", async () => {
    const fetchImpl = fakeNode([
      { asking: String(3n * AR), quantity: String(6n * AR), status: "settled" },
      { asking: String(4n * AR), quantity: String(2n * AR) },
    ]);

    expect(await readBestAsk(PROCESS, NODE, fetchImpl)).toEqual({ arPerToken: 2 });
  });

  it("ignores dust listings, which can't set a price", async () => {
    const fetchImpl = fakeNode([
      { asking: "1000", quantity: String(AR) },
      { asking: String(4n * AR), quantity: String(2n * AR) },
    ]);

    expect(await readBestAsk(PROCESS, NODE, fetchImpl)).toEqual({ arPerToken: 2 });
  });

  it("is unpriced when only dust is listed", async () => {
    expect(await readBestAsk(PROCESS, NODE, fakeNode([{ asking: "1000", quantity: String(AR) }]))).toBeNull();
  });

  it("is unpriced when nothing is listed", async () => {
    expect(await readBestAsk(PROCESS, NODE, fakeNode([]))).toBeNull();
  });

  it("scales by the token's denomination", async () => {
    const fetchImpl = fakeNode([{ asking: String(AR), quantity: "100" }], { denomination: "2" });

    expect(await readBestAsk(PROCESS, NODE, fetchImpl)).toEqual({ arPerToken: 1 });
  });

  it("is unpriced for a process that isn't a swap-capable token", async () => {
    expect(await readBestAsk(PROCESS, NODE, fakeNode([{ asking: String(AR), quantity: "1" }], { "execution-device": "lua@5.3a" }))).toBeNull();
  });

  it("is unpriced when the node refuses, without throwing", async () => {
    const refusing = vi.fn(async () => new Response("denied", { status: 403 })) as unknown as typeof fetch;
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    expect(await readBestAsk(PROCESS, NODE, refusing)).toBeNull();
    expect(await readBestAsk(PROCESS, NODE, failing)).toBeNull();
  });

  it("is unpriced when a listing's id doesn't match its key", async () => {
    const lying = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("process@1.0")) return new Response(null, { headers: { "execution-device": "token@1.0", denomination: "12", orders: `ao:${ORDERS}` } });
      if (url.endsWith(`${ORDERS}~message@1.0`)) return new Response(null, { headers: { [orderId(0)]: `ao:${orderId(0)}` } });
      return new Response(null, { headers: { "order-id": orderId(9), asking: String(AR), quantity: String(AR) } });
    }) as unknown as typeof fetch;

    expect(await readBestAsk(PROCESS, NODE, lying)).toBeNull();
  });

  it("refuses anything that isn't a process id before asking the node", async () => {
    const fetchImpl = fakeNode([]);

    expect(await readBestAsk("not-an-id", NODE, fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
