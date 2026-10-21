import "server-only";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { ga4DateToKey } from "./aggregate";
import { WINDOW_DAYS } from "./constants";
import type { PageSlice, TrafficDaily, TrafficSlice, TrafficSource } from "./types";

/**
 * Thrown with a message meant for the screen: the panel prints it verbatim, so it has to
 * say what to do, not just what broke.
 */
class Ga4Error extends Error {}

function credentials() {
  const propertyId = process.env.GA4_PROPERTY_ID?.trim();
  const clientEmail = process.env.GA4_SA_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GA4_SA_PRIVATE_KEY;
  if (!propertyId || !clientEmail || !privateKey) {
    throw new Ga4Error(
      "Google Analytics não está configurado (faltam GA4_PROPERTY_ID, GA4_SA_CLIENT_EMAIL ou GA4_SA_PRIVATE_KEY)."
    );
  }
  return {
    propertyId,
    clientEmail,
    // A chave privada tem quebras de linha de verdade. Ao passar por variável de ambiente
    // elas viram "\n" literais, e a assinatura falha com um erro de OpenSSL que não diz
    // nada sobre isso — daí desfazer aqui, tolerando a chave já correta.
    privateKey: privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey,
  };
}

function num(value: string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type Row = { dimensionValues?: ({ value?: string | null } | null)[] | null; metricValues?: ({ value?: string | null } | null)[] | null };

function dim(row: Row, i: number): string {
  return row.dimensionValues?.[i]?.value ?? "";
}

function metric(row: Row, i: number): number {
  return num(row.metricValues?.[i]?.value);
}

/**
 * Four reports in one round trip. Each breakdown keeps `date` as its first dimension so the
 * client can re-aggregate for any sub-period; without it we would be locked to whatever
 * range the server happened to ask for.
 */
export async function fetchTraffic(): Promise<TrafficSource> {
  const { propertyId, clientEmail, privateKey } = credentials();
  const client = new BetaAnalyticsDataClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
  });

  const dateRanges = [{ startDate: `${WINDOW_DAYS - 1}daysAgo`, endDate: "today" }];

  let responses;
  try {
    [{ reports: responses }] = (await client.batchRunReports({
      property: `properties/${propertyId}`,
      requests: [
        {
          dateRanges,
          dimensions: [{ name: "date" }],
          metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }],
        },
        {
          dateRanges,
          dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }],
        },
        {
          dateRanges,
          dimensions: [{ name: "date" }, { name: "deviceCategory" }],
          metrics: [{ name: "sessions" }],
        },
        {
          dateRanges,
          dimensions: [{ name: "date" }, { name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }],
        },
      ],
    })) as unknown as [{ reports?: { rows?: Row[] | null }[] | null }];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Dois problemas completamente diferentes chegam aqui como PERMISSION_DENIED, e mandam
    // para telas diferentes. Este primeiro é a Data API desligada no projeto do Google Cloud
    // — visto de verdade em 2026-09-08, na primeira tentativa de conectar. Sem esta
    // ramificação ele caía na mensagem de baixo e mandava conferir o acesso à propriedade,
    // que estava certo: meia hora procurando no lugar errado.
    if (/has not been used in project|SERVICE_DISABLED|analyticsdata\.googleapis\.com/.test(message)) {
      throw new Ga4Error(
        "A Google Analytics Data API está desligada no projeto do Google Cloud. Ative em " +
          "console.cloud.google.com → APIs e serviços → ative \"Google Analytics Data API\", " +
          "e espere um minuto para propagar."
      );
    }
    // Já este é a service account sem acesso à propriedade — o passo que mais se esquece,
    // porque criar a conta e liberá-la no GA4 são telas separadas.
    if (/PERMISSION_DENIED|403/.test(message)) {
      throw new Ga4Error(
        `O Google recusou o acesso à propriedade ${propertyId}. Confira se ${clientEmail} foi adicionado como Leitor (Viewer) em Admin → Gerenciamento de acesso à propriedade.`
      );
    }
    throw new Ga4Error(`Não foi possível ler o Google Analytics: ${message}`);
  }

  const [dailyReport, channelReport, deviceReport, pageReport] = responses ?? [];

  const daily: TrafficDaily[] = (dailyReport?.rows ?? []).map((row) => ({
    date: ga4DateToKey(dim(row, 0)),
    sessions: metric(row, 0),
    users: metric(row, 1),
    views: metric(row, 2),
  }));
  daily.sort((a, b) => a.date.localeCompare(b.date));

  const slice = (rows: Row[] | null | undefined): TrafficSlice[] =>
    (rows ?? []).map((row) => ({ date: ga4DateToKey(dim(row, 0)), key: dim(row, 1), sessions: metric(row, 0) }));

  const pages: PageSlice[] = (pageReport?.rows ?? []).map((row) => ({
    date: ga4DateToKey(dim(row, 0)),
    path: dim(row, 1),
    views: metric(row, 0),
  }));

  return {
    daily,
    channels: slice(channelReport?.rows),
    devices: slice(deviceReport?.rows),
    pages,
  };
}
