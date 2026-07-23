"""Fetch Zoo account usage via the official SDK (free /user endpoints)."""

from __future__ import annotations

from typing import Any


def fetch_zoo_usage(token: str, *, recent_limit: int = 12) -> dict[str, Any]:
    """Return sanitized balance + recent billable API call summaries.

    Uses KittyCAD SDK so Cloudflare accepts the client. Never returns email,
    IP, raw tokens, or other PII from the API-calls payload.
    """
    from kittycad import KittyCAD

    client = KittyCAD(token=token)
    client.headers["User-Agent"] = "MeshMoose.ai/0.1"

    balance = client.payments.get_payment_balance_for_user()
    bal = balance.model_dump(mode="json") if hasattr(balance, "model_dump") else dict(balance)

    sub = (bal.get("subscription_details") or {}).get("modeling_app") or {}
    monthly_included = sub.get("monthly_pay_as_you_go_api_credits")
    monthly_value = sub.get("monthly_pay_as_you_go_api_credits_monetary_value")
    credit_price = sub.get("pay_as_you_go_api_credit_price")

    recent: list[dict[str, Any]] = []
    total_seconds = 0
    total_price = 0.0
    for i, call in enumerate(client.api_calls.user_list_api_calls(limit=recent_limit)):
        raw = call.model_dump(mode="json") if hasattr(call, "model_dump") else dict(call)
        seconds = int(raw.get("seconds") or 0)
        price = float(raw.get("price") or 0)
        total_seconds += seconds
        total_price += price
        endpoint = str(raw.get("endpoint") or "")
        # Strip query string for display privacy / brevity.
        endpoint_path = endpoint.split("?", 1)[0]
        recent.append(
            {
                "id": raw.get("id"),
                "endpoint": endpoint_path,
                "method": raw.get("method"),
                "seconds": seconds,
                "minutes": raw.get("minutes"),
                "price": price,
                "status_code": raw.get("status_code"),
                "created_at": raw.get("created_at"),
                # Intentionally omit email, IP, user_agent, and query strings.
            }
        )
        if i + 1 >= recent_limit:
            break

    return {
        "balance": {
            "monthly_api_credits_remaining": bal.get("monthly_api_credits_remaining"),
            "monthly_api_credits_remaining_monetary_value": bal.get(
                "monthly_api_credits_remaining_monetary_value"
            ),
            "stable_api_credits_remaining": bal.get("stable_api_credits_remaining"),
            "stable_api_credits_remaining_monetary_value": bal.get(
                "stable_api_credits_remaining_monetary_value"
            ),
            "monthly_included_credits": monthly_included,
            "monthly_included_monetary_value": monthly_value,
            "pay_as_you_go_credit_price": credit_price,
            "plan_name": sub.get("display_name") or sub.get("name"),
            "updated_at": bal.get("updated_at"),
        },
        "recent_calls": recent,
        "recent_totals": {
            "count": len(recent),
            "seconds": total_seconds,
            "price": round(total_price, 4),
        },
        "pricing_note": (
            "Zoo meters most billable calls by the second (~$0.0083/s). "
            "Account balance endpoints are free. See https://zoo.dev/api-pricing"
        ),
    }
