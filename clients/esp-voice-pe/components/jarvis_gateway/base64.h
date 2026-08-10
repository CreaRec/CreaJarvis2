#pragma once
/** Minimal base64 encode/decode for PCM payloads (host + ESP). */
#include <cctype>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace crea_jarvis {
namespace logic {

inline const char *b64_table() {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
}

inline std::string base64_encode(const uint8_t *data, size_t len) {
  std::string out;
  out.reserve(((len + 2) / 3) * 4);
  const char *t = b64_table();
  for (size_t i = 0; i < len; i += 3) {
    uint32_t n = static_cast<uint32_t>(data[i]) << 16;
    if (i + 1 < len)
      n |= static_cast<uint32_t>(data[i + 1]) << 8;
    if (i + 2 < len)
      n |= static_cast<uint32_t>(data[i + 2]);
    out.push_back(t[(n >> 18) & 63]);
    out.push_back(t[(n >> 12) & 63]);
    out.push_back(i + 1 < len ? t[(n >> 6) & 63] : '=');
    out.push_back(i + 2 < len ? t[n & 63] : '=');
  }
  return out;
}

inline int b64_val(char c) {
  if (c >= 'A' && c <= 'Z')
    return c - 'A';
  if (c >= 'a' && c <= 'z')
    return c - 'a' + 26;
  if (c >= '0' && c <= '9')
    return c - '0' + 52;
  if (c == '+')
    return 62;
  if (c == '/')
    return 63;
  return -1;
}

inline bool base64_decode(const char *in, size_t in_len, std::vector<uint8_t> &out) {
  out.clear();
  if (!in)
    return false;
  out.reserve(in_len * 3 / 4 + 4);
  int val = 0, valb = -8;
  for (size_t i = 0; i < in_len; i++) {
    char c = in[i];
    if (c == '=' || std::isspace(static_cast<unsigned char>(c)))
      continue;
    int d = b64_val(c);
    if (d < 0)
      return false;
    val = (val << 6) + d;
    valb += 6;
    if (valb >= 0) {
      out.push_back(static_cast<uint8_t>((val >> valb) & 0xFF));
      valb -= 8;
    }
  }
  return true;
}

inline bool base64_decode(const char *in, std::vector<uint8_t> &out) {
  if (!in)
    return false;
  return base64_decode(in, std::strlen(in), out);
}

}  // namespace logic
}  // namespace crea_jarvis
