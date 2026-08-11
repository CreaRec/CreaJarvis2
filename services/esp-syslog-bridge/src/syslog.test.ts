import { describe, expect, it } from "vitest";
import { severityFromSyslogPri } from "./severity.js";
import { parseEspSyslog, stripAnsi } from "./syslog.js";

describe("severityFromSyslogPri", () => {
  it("maps emerg/alert/crit/err to ERROR", () => {
    expect(severityFromSyslogPri(16 * 8 + 0)).toBe("ERROR");
    expect(severityFromSyslogPri(16 * 8 + 3)).toBe("ERROR");
  });

  it("maps warning to WARN", () => {
    expect(severityFromSyslogPri(16 * 8 + 4)).toBe("WARN");
  });

  it("maps notice/info to INFO", () => {
    expect(severityFromSyslogPri(16 * 8 + 5)).toBe("INFO");
    expect(severityFromSyslogPri(16 * 8 + 6)).toBe("INFO");
  });

  it("maps debug to DEBUG", () => {
    expect(severityFromSyslogPri(16 * 8 + 7)).toBe("DEBUG");
  });
});

describe("stripAnsi", () => {
  it("removes color codes", () => {
    expect(stripAnsi("\x1b[1;31mhello\x1b[0m")).toBe("hello");
  });
});

describe("parseEspSyslog", () => {
  it("parses ESPHome-style packet with timestamp", () => {
    const raw =
      "<134>Aug 11 08:31:42 jarvis-voice-pe-0a0ebb jarvis_gateway: hello.ok";
    const parsed = parseEspSyslog(raw);
    expect(parsed).toEqual({
      severity: "INFO",
      hostName: "jarvis-voice-pe-0a0ebb",
      espTag: "jarvis_gateway",
      message: "hello.ok",
    });
  });

  it("parses packet with dash timestamp", () => {
    const raw =
      "<132>- jarvis-voice-pe-0a0ebb wifi: Connected";
    const parsed = parseEspSyslog(raw);
    expect(parsed).toEqual({
      severity: "WARN",
      hostName: "jarvis-voice-pe-0a0ebb",
      espTag: "wifi",
      message: "Connected",
    });
  });

  it("parses ERROR severity from PRI", () => {
    const raw =
      "<131>Aug 11 09:00:00 host app: boom";
    expect(parseEspSyslog(raw)?.severity).toBe("ERROR");
  });

  it("strips ANSI in message", () => {
    const raw =
      "<134>Aug 11 09:00:00 host tag: \x1b[32mok\x1b[0m";
    expect(parseEspSyslog(raw)?.message).toBe("ok");
  });

  it("returns null for empty / garbage", () => {
    expect(parseEspSyslog("")).toBeNull();
    expect(parseEspSyslog("not-syslog")).toBeNull();
    expect(parseEspSyslog("<999>bad")).toBeNull();
  });

  it("accepts Buffer input", () => {
    const buf = Buffer.from(
      "<134>Aug 11 08:31:42 host tag: msg",
      "utf8",
    );
    expect(parseEspSyslog(buf)?.message).toBe("msg");
  });
});
