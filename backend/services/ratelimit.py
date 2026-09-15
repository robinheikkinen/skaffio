"""Rate limiter — skyddar login/register mot brute-force.

Använder real-client-IP som nyckel. Bakom Cloudflare Tunnel föredras
CF-Connecting-IP (innehåller faktisk klientens IP, satt av Cloudflare).
Med port-bindning 127.0.0.1:8007 kan CF-Connecting-IP inte spoofas från LAN.
"""

from fastapi import Request
from slowapi import Limiter


def _get_real_ip(request: Request) -> str:
    """Hämtar klientens riktiga IP — prioriterar CF-Connecting-IP via Cloudflare Tunnel."""
    # CF-Connecting-IP: sätts av Cloudflare med klientens faktiska IP
    cf = request.headers.get("cf-connecting-ip", "").strip()
    if cf:
        return cf
    # X-Real-IP: sätts av nginx/Twingate-proxy
    real = request.headers.get("x-real-ip", "").strip()
    if real:
        return real
    # X-Forwarded-For: kan vara komma-separerad — ta första (närmsta klient)
    xff = request.headers.get("x-forwarded-for", "").strip()
    if xff:
        return xff.split(",")[0].strip()
    # Fallback: direkt socket-IP
    if request.client:
        return request.client.host
    return "unknown"


limiter = Limiter(key_func=_get_real_ip, default_limits=["60/minute"])
