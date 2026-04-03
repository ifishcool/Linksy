import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getBillingProduct } from '@/lib/billing/catalog';
import { getStripeServerClient } from '@/lib/stripe';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

function buildExpiryDate(billingCycle: 'monthly' | 'yearly', currentExpiry?: string | null) {
  const now = new Date();
  const base =
    currentExpiry && new Date(currentExpiry) > now ? new Date(currentExpiry) : new Date();

  if (billingCycle === 'yearly') {
    base.setFullYear(base.getFullYear() + 1);
  } else {
    base.setMonth(base.getMonth() + 1);
  }

  return base.toISOString();
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'Missing Stripe webhook config' }, { status: 400 });
  }

  const stripe = getStripeServerClient();
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid webhook signature';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata ?? {};
    const userId = metadata.userId;
    const productId = metadata.productId;

    if (userId && productId) {
      const product = getBillingProduct(productId);
      if (product) {
        const supabaseAdmin = getSupabaseAdminClient();
        const billingOrders = (supabaseAdmin as any).from('billing_orders');
        const paymentIntentId =
          typeof session.payment_intent === 'string' ? session.payment_intent : null;
        const amountPaid = session.amount_total ?? product.unitAmount;
        const paidAt = new Date().toISOString();

        const { data: existingOrder } = await billingOrders
          .select(
            'id,entitlement_status,subscription_expires_at,product_kind,score_delta,billing_cycle,amount_paid',
          )
          .eq('stripe_session_id', session.id)
          .maybeSingle();

        if (!existingOrder) {
          const initialOrder = {
            user_id: userId,
            stripe_session_id: session.id,
            stripe_payment_intent_id: paymentIntentId,
            product_id: product.id,
            product_kind: product.kind,
            billing_cycle: product.kind === 'pro_pass' ? product.billingCycle : null,
            amount_paid: amountPaid,
            currency: session.currency ?? product.currency,
            status: session.payment_status ?? session.status ?? 'paid',
            entitlement_status: 'pending',
            score_delta: product.kind === 'score_pack' ? product.scoreDelta : 0,
            subscription_plan: product.kind === 'pro_pass' ? 'pro' : null,
            paid_at: paidAt,
            raw_event: event as unknown as Record<string, unknown>,
          };

          await billingOrders.insert(initialOrder);
        } else {
          await billingOrders
            .update({
              stripe_payment_intent_id: paymentIntentId,
              status: session.payment_status ?? session.status ?? 'paid',
              amount_paid: amountPaid,
              currency: session.currency ?? product.currency,
              paid_at: paidAt,
              raw_event: event as unknown as Record<string, unknown>,
            })
            .eq('id', existingOrder.id);
        }

        if (existingOrder?.entitlement_status === 'applied') {
          return NextResponse.json({ received: true });
        }

        const {
          data: { user },
          error: userError,
        } = await supabaseAdmin.auth.admin.getUserById(userId);

        if (!userError && user) {
          const userMetadata = user.user_metadata ?? {};
          const nextMetadata: Record<string, unknown> = { ...userMetadata };
          let nextExpiry: string | null = null;

          if (product.kind === 'score_pack') {
            const currentScore = Number(userMetadata.aiLearningScore ?? 0) || 0;
            nextMetadata.aiLearningScore = currentScore + product.scoreDelta;
          }

          if (product.kind === 'pro_pass') {
            nextMetadata.subscriptionPlan = 'pro';
            nextMetadata.subscriptionStatus = 'active';
            nextMetadata.subscriptionBillingCycle = product.billingCycle;
            nextMetadata.subscriptionUpdatedAt = new Date().toISOString();
            nextExpiry = buildExpiryDate(
              product.billingCycle,
              typeof userMetadata.subscriptionExpiresAt === 'string'
                ? userMetadata.subscriptionExpiresAt
                : null,
            );
            nextMetadata.subscriptionExpiresAt = nextExpiry;
          }

          const { error: updateUserError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            user_metadata: nextMetadata,
          });

          await billingOrders
            .update({
              entitlement_status: updateUserError ? 'failed' : 'applied',
              subscription_expires_at: nextExpiry,
              subscription_plan: product.kind === 'pro_pass' ? 'pro' : null,
            })
            .eq('stripe_session_id', session.id);
        } else {
          await billingOrders
            .update({
              entitlement_status: 'failed',
            })
            .eq('stripe_session_id', session.id);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}

export const runtime = 'nodejs';
