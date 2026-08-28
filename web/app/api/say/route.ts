/** Proxy to the Brain so the page needs no CORS story for POSTs. */
export async function POST(request: Request) {
  const body = await request.text();
  const response = await fetch("http://127.0.0.1:8484/say", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
