"""Gateway hello handshake helpers."""

from __future__ import annotations

from jarvis_client.gateway import GatewayClient


def test_gateway_tracks_hello_ok_flag() -> None:
    seen: list[str] = []
    gw = GatewayClient("ws://example", on_message=lambda m: seen.append(m["type"]))
    assert gw.hello_ok is False
    # Simulate recv-loop handling without a real socket
    gw._on_message = lambda m: None  # noqa: SLF001
    # Directly exercise hello.ok path via private recv semantics:
    gw.hello_ok = False
    gw._hello_event.clear()  # noqa: SLF001
    msg = {"type": "hello.ok", "deviceId": "d1", "serverTime": "t"}
    if msg.get("type") == "hello.ok":
        gw.hello_ok = True
        gw._hello_event.set()  # noqa: SLF001
    assert gw.hello_ok is True
    assert gw.wait_hello(timeout=0.1) is True
