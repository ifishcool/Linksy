import { NextRequest, NextResponse } from 'next/server';
import { getStripeServerClient } from '@/lib/stripe';

function redirectHome(req: NextRequest, params: Record<string, string>) {
  const url = new URL('/', req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');
  if (!sessionId) {
    return redirectHome(req, { checkout: 'error' });
  }

  try {
    const stripe = getStripeServerClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.status !== 'complete') {
      return redirectHome(req, { checkout: 'cancelled' });
    }

    const metadata = session.metadata ?? {};
    const userId = metadata.userId;
    const kind = metadata.kind;

    if (!userId || !kind) {
      return redirectHome(req, { checkout: 'error' });
    }

    return redirectHome(req, {
      checkout: 'success',
      sessionId: session.id,
    });
  } catch {
    return redirectHome(req, { checkout: 'error' });
  }
}
