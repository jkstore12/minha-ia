/**
 * Adapter de handlers Vercel legacy (req, res) para o shape App Router
 * do Next.js (Request, Response).
 *
 * Os 3 webhooks do projeto (Telegram, WhatsApp, QR code) foram originalmente
 * deployados como Vercel serverless functions em `api/*.js`, com o shape
 * `(req, res)`. Para trazê-los para dentro do App Router e usar os
 * helpers compartilhados em `src/lib/*`, este adapter converte:
 *
 *   - Request (App Router) -> req (Vercel shape: method, body, headers, query, url)
 *   - res (Vercel shape: status().json().setHeader().end()) -> Response
 *
 * Limitacoes conhecidas:
 *   - `res.write()` chunked nao e suportado (webhooks do projeto nao usam).
 *   - Streaming via `res.write` precisaria de um transform stream custom.
 *   - `req.body` e parseado como JSON uma vez. Se o handler chamar
 *     `request.json()` diretamente via Vercel, o adapter ja parseou.
 *     Para reuso, `req.body` contem o objeto ja parseado.
 *
 * Para migrar um handler para Request/Response nativo, o caller deve
 * reescreve-lo. O adapter existe para minimizar diff e risco.
 */

type VercelHeaders = Record<string, string | string[] | undefined>;

type VercelReq = {
  method: string;
  body: unknown;
  headers: VercelHeaders;
  query: Record<string, string | string[] | undefined>;
  url: string;
};

type VercelRes = {
  status: (code: number) => VercelRes;
  json: (data: unknown) => VercelRes;
  setHeader: (name: string, value: string | string[]) => VercelRes;
  setHeaders: (headers: Record<string, string>) => VercelRes;
  end: () => VercelRes;
};

export type VercelHandler = (req: VercelReq, res: VercelRes) => Promise<unknown> | unknown;

export function adaptVercelHandler(handler: VercelHandler) {
  return async (request: Request): Promise<Response> => {
    // Extrai headers para o shape Vercel (lowercased).
    const headers: VercelHeaders = {};
    request.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      const existing = headers[lower];
      if (existing === undefined) {
        headers[lower] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        headers[lower] = [existing, value];
      }
    });

    // Extrai query string.
    const url = new URL(request.url);
    const query: Record<string, string | string[]> = {};
    url.searchParams.forEach((value, key) => {
      const existing = query[key];
      if (existing === undefined) {
        query[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        query[key] = [existing, value];
      }
    });

    // Parse do body: JSON para POST/PUT/PATCH, undefined para GET/HEAD.
    let body: unknown = undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const contentType = request.headers.get("content-type") || "";
      try {
        if (contentType.includes("application/json")) {
          body = await request.json();
        } else if (
          contentType.includes("application/x-www-form-urlencoded") ||
          contentType.includes("multipart/form-data")
        ) {
          // Para webhooks do projeto, todos usam JSON. Webhook forms nao
          // sao esperados. Mantemos string como fallback.
          body = await request.text();
        } else {
          // Default: tenta JSON, fallback para text.
          try {
            body = await request.json();
          } catch {
            body = await request.text();
          }
        }
      } catch {
        body = undefined;
      }
    }

    // Mock do `res` Vercel. Acumula status + headers + body.
    let statusCode = 200;
    const headerBag: Record<string, string> = {};
    let jsonBody: unknown | undefined = undefined;
    const textBody: string | undefined = undefined;
    let ended = false;

    const res: VercelRes = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        jsonBody = data;
        ended = true;
        return res;
      },
      setHeader: (name, value) => {
        const lower = name.toLowerCase();
        headerBag[lower] = Array.isArray(value) ? value.join(", ") : String(value);
        return res;
      },
      setHeaders: (h) => {
        for (const [k, v] of Object.entries(h)) {
          headerBag[k.toLowerCase()] = String(v);
        }
        return res;
      },
      end: () => {
        ended = true;
        return res;
      },
    };

    const req: VercelReq = {
      method: request.method,
      body,
      headers,
      query,
      url: request.url,
    };

    try {
      await handler(req, res);
    } catch (err) {
      if (!ended) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "webhook_error",
            message: err instanceof Error ? err.message : String(err),
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    const responseHeaders = new Headers();
    for (const [k, v] of Object.entries(headerBag)) {
      responseHeaders.set(k, v);
    }

    if (jsonBody !== undefined) {
      if (!responseHeaders.has("content-type")) {
        responseHeaders.set("Content-Type", "application/json");
      }
      return new Response(JSON.stringify(jsonBody), {
        status: statusCode,
        headers: responseHeaders,
      });
    }

    if (textBody !== undefined) {
      return new Response(textBody, { status: statusCode, headers: responseHeaders });
    }

    // Handler nao escreveu body. Vercel default e 204; mantemos 200 para
    // casar com o comportamento historico dos webhooks.
    return new Response(null, { status: statusCode, headers: responseHeaders });
  };
}