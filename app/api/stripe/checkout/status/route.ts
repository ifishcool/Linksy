import { NextRequest, NextResponse } from 'next/server';
import { getBillingProduct } from '@/lib/billing/catalog';
import { getStripeServerClient } from '@/lib/stripe';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const sessionId = req.nextUrl.searchParams.get('session_id');

  if (!token || !sessionId) {
    return NextResponse.json({ error: 'Missing auth token or session id' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stripe = getStripeServerClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const metadata = session.metadata ?? {};

  if (metadata.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const product = metadata.productId ? getBillingProduct(metadata.productId) : null;
  const supabaseAdmin = getSupabaseAdminClient();
  const billingOrders = (supabaseAdmin as any).from('billing_orders');
  const { data: order } = await billingOrders
    .select(
      'status,entitlement_status,product_id,product_kind,billing_cycle,score_delta,subscription_expires_at',
    )
    .eq('user_id', user.id)
    .eq('stripe_session_id', session.id)
    .maybeSingle();

  return NextResponse.json({
    status: session.status,
    paymentStatus: session.payment_status,
    processed: order?.entitlement_status === 'applied',
    kind: order?.product_kind ?? product?.kind ?? null,
    productId: order?.product_id ?? product?.id ?? null,
    scoreDelta:
      order?.product_kind === 'score_pack'
        ? Number(order.score_delta ?? 0) || 0
        : product?.kind === 'score_pack'
          ? product.scoreDelta
          : 0,
    billingCycle:
      order?.product_kind === 'pro_pass'
        ? (order.billing_cycle ?? null)
        : product?.kind === 'pro_pass'
          ? product.billingCycle
          : null,
    currentScore: Number(user.user_metadata?.aiLearningScore ?? 0) || 0,
    subscriptionExpiresAt: order?.subscription_expires_at ?? null,
  });
}
