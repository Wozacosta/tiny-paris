import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn();
vi.mock("@vercel/blob", () => ({ put }));
const { POST } = await import("../../api/report");

let ip = 0;
const send = (body: unknown) =>
  POST(new Request("https://tiny.paris/api/report", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": `10.0.0.${++ip}` },
  }));

describe("POST /api/report", () => {
  beforeEach(() => put.mockClear());

  it("saves a report as a private JSON file", async () => {
    const res = await send({ kind: "looks-wrong", note: " Wrong roof ", building: "Louvre", lon: 2.33764123, lat: 48.86, zoom: 3 });
    expect(res.status).toBe(204);
    expect(put).toHaveBeenCalledOnce();
    const [path, json, opts] = put.mock.calls[0];
    expect(path).toMatch(/^reports\/\d{4}-\d\d-\d\d\/\d{6}\.json$/);
    expect(JSON.parse(json)).toMatchObject({ kind: "looks-wrong", note: "Wrong roof", building: "Louvre", lon: 2.33764 });
    expect(opts.access).toBe("private");
  });

  it("refuses bad input", async () => {
    expect((await send("not json")).status).toBe(400);
    expect((await send({ kind: "spam" })).status).toBe(400);
    expect((await send({ kind: "other" })).status).toBe(400); // "something else" needs a note
    expect((await send("x".repeat(5000))).status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it("quietly drops what bots fill in", async () => {
    expect((await send({ kind: "missing", website: "http://spam" })).status).toBe(204);
    expect(put).not.toHaveBeenCalled();
  });

  it("limits a visitor to five reports per ten minutes", async () => {
    const one = () =>
      POST(new Request("https://tiny.paris/api/report", { method: "POST", body: JSON.stringify({ kind: "missing" }), headers: { "x-forwarded-for": "10.9.9.9" } }));
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await one()).status);
    expect(codes).toEqual([204, 204, 204, 204, 204, 429]);
  });
});
