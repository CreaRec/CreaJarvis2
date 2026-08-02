"""Tests for HTTP base URL helper."""

from jarvis_client.http_util import http_base_from_ws


def test_http_base_from_ws_default_port() -> None:
    assert http_base_from_ws("ws://127.0.0.1:8787/voice") == "http://127.0.0.1:8787"


def test_http_base_from_ws_wss() -> None:
    assert http_base_from_ws("wss://example.com/voice") == "https://example.com:443"
